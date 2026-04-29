@echo off
echo.
echo Finance Hub Setup
echo =================

mkdir data 2>nul

python -m venv venv
call venv\Scripts\activate
pip install -q -r requirements.txt

echo.
echo Starting Finance Hub at http://localhost:5000
echo Press Ctrl+C to stop
echo.

python app.py
