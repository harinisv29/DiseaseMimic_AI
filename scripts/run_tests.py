import sys
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'.packages'),str(ROOT)]
sys.path.insert(0,str(ROOT/'scripts'))
from runtime import configure
configure()
import pytest

class Report:
    def pytest_sessionfinish(self,session,exitstatus):
        terminal=session.config.pluginmanager.get_plugin('terminalreporter')
        report=dict(exit_code=int(exitstatus),collected=session.testscollected,
                    passed=len(terminal.stats.get('passed',[])),failed=len(terminal.stats.get('failed',[])),
                    errors=len(terminal.stats.get('error',[])))
        (ROOT/'data/metadata/test_report.json').write_text(json.dumps(report,indent=2))

raise SystemExit(pytest.main([str(ROOT/'tests'),'-q'],plugins=[Report()]))
