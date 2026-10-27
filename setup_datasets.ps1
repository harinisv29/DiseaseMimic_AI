$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $projectPython = Join-Path $PSScriptRoot '.runtime\python\python.exe'
    foreach ($datasetScript in @('scripts/download_datasets.py','scripts/preprocess_datasets.py','scripts/validate_datasets.py')) {
        & $projectPython run.py $datasetScript
        if ($LASTEXITCODE -ne 0) { throw "Dataset setup failed: $datasetScript" }
    }
} finally { Pop-Location }
