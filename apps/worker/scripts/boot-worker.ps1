# =============================================================================================
# boot-worker.ps1 -- bring the Master Weaver worker up after a reboot.
#
# Registered as a Scheduled Task (see README section "Autostart"). The task runs this script,
# this script runs the worker in the FOREGROUND, and so the task's lifetime is the worker's
# lifetime -- which is what makes Task Scheduler's restart-on-failure meaningful. Spawning the
# worker detached and exiting would hand back a task that reports success while the worker is
# dead, and that Task Scheduler can neither stop nor restart.
#
# Order matters: Docker, then Postgres, then the worker. The worker validates DATABASE_URL at
# boot and exits 78 rather than retrying, so starting it before Postgres answers is a guaranteed
# failure -- one the restart policy would then paper over three times and give up on.
#
# Written for Windows PowerShell 5.1. Native commands are invoked through `cmd /c` and checked
# with $LASTEXITCODE, because 5.1 wraps a native executable's stderr in an ErrorRecord and sets
# $? to false even on exit code 0 -- so `docker info 2>$null` looks like a failure when it is not.
# =============================================================================================

$ErrorActionPreference = 'Stop'

$Repo      = 'g:\Master Weaver'
$WorkerDir = Join-Path $Repo 'apps\worker'
$LogDir    = Join-Path $WorkerDir '.logs'
$BootLog   = Join-Path $LogDir 'boot.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Boot([string]$Message) {
    $line = "$(Get-Date -Format o)  $Message"
    $line | Out-File -FilePath $BootLog -Append -Encoding utf8
}

# Exit code 0 means the command succeeded. Nothing is captured: these are liveness probes, and
# their output is noise.
function Test-Command([string]$CommandLine) {
    cmd /c "$CommandLine >NUL 2>&1"
    return ($LASTEXITCODE -eq 0)
}

Write-Boot '--- boot-worker starting ---'

# ---------------------------------------------------------------------------------------------
# 0. Refuse to start a second worker.
#
# Two workers against one queue is not a correctness problem -- the claim is FOR UPDATE SKIP
# LOCKED and the cron's INSERT is guarded by NOT EXISTS, so they would interleave safely. It is a
# cost problem: each one bills for its own scrapes. MultipleInstances=IgnoreNew covers the task
# firing twice; this covers a task firing while a hand-started worker is already up.
# ---------------------------------------------------------------------------------------------
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*start-detached.mjs*' }
if ($null -ne $existing) {
    foreach ($proc in $existing) { Write-Boot "worker already running (PID $($proc.ProcessId)) -- exiting" }
    exit 0
}

# ---------------------------------------------------------------------------------------------
# 1. Wait for the Docker daemon.
#
# Docker Desktop starts at user logon and takes a while to become answerable, so a task that
# fires the moment the desktop appears will find no daemon for a minute or more. Ten minutes is
# generous on purpose: the cost of waiting is a late first scrape, the cost of giving up early is
# no worker at all until someone notices.
# ---------------------------------------------------------------------------------------------
$dockerDeadline = (Get-Date).AddMinutes(10)
$dockerReady = $false
while ((Get-Date) -lt $dockerDeadline) {
    if (Test-Command 'docker info') { $dockerReady = $true; break }
    Start-Sleep -Seconds 10
}

if (-not $dockerReady) {
    Write-Boot 'FATAL: Docker daemon did not become available within 10 minutes -- giving up'
    exit 1
}
Write-Boot 'docker daemon is up'

# ---------------------------------------------------------------------------------------------
# 2. Make sure Postgres answers -- and only intervene if it does not.
#
# Docker Desktop restarts its containers on login, so the usual case is that Supabase is already
# up and nothing needs doing. `supabase start` is NOT harmless here: when a container fails its
# health check the CLI stops the whole stack, database included. Running it against a healthy
# stack risks destroying the thing this script exists to guarantee. So it is a fallback, not a
# step.
# ---------------------------------------------------------------------------------------------
$pgProbe = 'docker exec supabase_db_Master_Weaver pg_isready -U postgres'

$pgDeadline = (Get-Date).AddMinutes(3)
$pgReady = $false
while ((Get-Date) -lt $pgDeadline) {
    if (Test-Command $pgProbe) { $pgReady = $true; break }
    Start-Sleep -Seconds 5
}

if ($pgReady) {
    Write-Boot 'postgres already accepting connections -- skipping supabase start'
} else {
    Write-Boot 'postgres unreachable after 3 minutes -- running supabase start'

    # From the repo root: that is where supabase/config.toml lives, and the CLI resolves the
    # project from the working directory.
    Push-Location $Repo
    try {
        cmd /c "npx -y supabase@latest start >> `"$BootLog`" 2>&1"
        Write-Boot "supabase start exited with code $LASTEXITCODE"
    } finally {
        Pop-Location
    }

    $pgDeadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $pgDeadline) {
        if (Test-Command $pgProbe) { $pgReady = $true; break }
        Start-Sleep -Seconds 5
    }
}

if (-not $pgReady) {
    Write-Boot 'FATAL: postgres never became reachable -- not starting the worker (it would exit 78)'
    exit 1
}
Write-Boot 'postgres is ready'

# ---------------------------------------------------------------------------------------------
# 3. Run the worker in the foreground.
#
# start-detached.mjs loads .env in-process, which is the whole reason it exists: the environment
# reaches the worker without BRIGHTDATA_API_KEY ever appearing on a command line, in the process
# table, or in this script. Its name is now slightly wrong -- nothing here detaches -- but it is
# referenced from the git history and the README, so it keeps the name.
#
# This blocks. That is deliberate: while node runs, the task shows as Running, and when node dies
# the task ends with node's exit code, which is what Task Scheduler restarts on.
# ---------------------------------------------------------------------------------------------
Write-Boot 'starting worker'

cmd /c "cd /d `"$WorkerDir`" && node --enable-source-maps scripts\start-detached.mjs >> `".logs\worker.log`" 2>> `".logs\worker.err.log`""
$workerExit = $LASTEXITCODE

Write-Boot "worker exited with code $workerExit"
exit $workerExit
