#!/bin/zsh
cd "${0:A:h}"
open http://localhost:8000
python3 server.py
