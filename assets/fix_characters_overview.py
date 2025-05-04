import json
import os

# Get the directory of this script.
script_dir = os.path.dirname(os.path.abspath(__file__))

# Construct the absolute path to the JSON file.
file_path = os.path.join(script_dir, 'characters_overview.json')

# Load the current characters_overview.json
with open(file_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Convert array to dict keyed by slug
converted = {entry['slug']: entry for entry in data}

# Overwrite the original file safely
with open(file_path, 'w', encoding='utf-8') as f:
    json.dump(converted, f, indent=2)

print("✅ characters_overview.json has been fixed and overwritten.")
