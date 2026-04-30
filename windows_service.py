"""
windows_service.py
Installs FinHub as a Windows background service.
Requires: pip install pywin32

Usage:
  Install:   python windows_service.py install
  Start:     python windows_service.py start
  Stop:      python windows_service.py stop
  Remove:    python windows_service.py remove
  Auto-start on boot: python windows_service.py --startup=auto install
"""
import sys
import os
import subprocess

# Add project root to path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

try:
    import win32serviceutil
    import win32service
    import win32event
    import servicemanager
    import socket
except ImportError:
    print("pywin32 not installed. Run: pip install pywin32")
    print("Then run: python windows_service.py install")
    sys.exit(1)


class FinHubService(win32serviceutil.ServiceFramework):
    _svc_name_        = 'FinHub'
    _svc_display_name_= 'FinHub — Personal Finance Hub'
    _svc_description_ = 'Self-hosted finance dashboard (Flask)'

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.process    = None

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        if self.process:
            self.process.terminate()

    def SvcDoRun(self):
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, '')
        )
        self._run()

    def _run(self):
        venv_python = os.path.join(BASE_DIR, 'venv', 'Scripts', 'python.exe')
        app_script  = os.path.join(BASE_DIR, 'app.py')

        if not os.path.exists(venv_python):
            servicemanager.LogErrorMsg(f'venv not found at {venv_python}')
            return

        env = os.environ.copy()
        env['PYTHONPATH'] = BASE_DIR

        # Load .env manually since the service won't have it
        env_file = os.path.join(BASE_DIR, '.env')
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, _, val = line.partition('=')
                        env[key.strip()] = val.strip().strip('"').strip("'")

        self.process = subprocess.Popen(
            [venv_python, app_script],
            cwd=BASE_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Wait for stop signal
        win32event.WaitForSingleObject(self.stop_event, win32event.INFINITE)


if __name__ == '__main__':
    if len(sys.argv) == 1:
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(FinHubService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        win32serviceutil.HandleCommandLine(FinHubService)
