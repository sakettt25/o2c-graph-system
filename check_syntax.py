#!/usr/bin/env python3
import json
import subprocess
import sys

# Try to build next.js
result = subprocess.run([sys.executable, '-m', 'json.tool'], capture_output=True, text=True, cwd='c:\\Users\\KIIT0001\\Downloads\\o2c-graph-system')
print("BUILD ATTEMPT")

# Try to parse and find issues
try:
    with open('c:\\Users\\KIIT0001\\Downloads\\o2c-graph-system\\app\\api\\chat\\route.ts', 'r') as f:
        content = f.read()
    print("File read successfully")
    print(f"File length: {len(content)} characters")
    print(f"File lines: {len(content.splitlines())}")
    
    # Look for syntax issues
    if '{ status: 404 }' in content:
        print("Found '{ status: 404 }' in file")
    else:
        print("'{ status: 404 }' NOT found in file (good)")
        
except Exception as e:
    print(f"Error: {e}")
