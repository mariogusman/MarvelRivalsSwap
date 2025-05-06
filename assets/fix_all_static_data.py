#!/usr/bin/env python3
import os
import json
import re

# Static data paths
BASE_DIR = os.path.dirname(__file__)
OVERVIEW_PATH = os.path.join(BASE_DIR, 'characters_overview.json')
TEAMUPS_PATH = os.path.join(BASE_DIR, 'teamups.json')
MATCHUPS_DIR = os.path.join(BASE_DIR, 'matchups')

# Utility: normalize to lowercase slug with single hyphens and alphanumerics
SLUG_PATTERN = re.compile(r'[^a-z0-9-]')
def normalize_slug(s):
    s = s.strip().lower()
    s = re.sub(r'[-\s]+', '-', s)
    s = SLUG_PATTERN.sub('', s)
    return s

# New helper functions for parsing numbers
def parse_int(v):
    if isinstance(v, str):
        # Remove any non-digit characters
        v = re.sub(r'\D', '', v)
    try:
        return int(v)
    except:
        return 0

def parse_num(v):
    if isinstance(v, str):
        # Remove commas, percentage symbols, and any non-digit/non-dot chars
        v = v.replace(',', '').replace('%', '')
        v = re.sub(r'[^\d\.]', '', v)
    try:
        return float(v)
    except:
        return 0.0

# 1. Normalize characters_overview.json slugs
with open(OVERVIEW_PATH, 'r', encoding='utf-8') as f:
    overview = json.load(f)
updated_overview = {}
valid_slugs = set()
for orig_slug, info in overview.items():
    norm = normalize_slug(info.get('slug', orig_slug))
    valid_slugs.add(norm)
    info['slug'] = norm
    updated_overview[norm] = info
with open(OVERVIEW_PATH, 'w', encoding='utf-8') as f:
    json.dump(updated_overview, f, indent=2)
print(f"Normalized {len(valid_slugs)} hero slugs.")

# 2. Clean teamups.json: ensure all hero slugs valid
with open(TEAMUPS_PATH, 'r', encoding='utf-8') as f:
    teamups = json.load(f)
fixed_teamups = []
for entry in teamups:
    team = entry.get('team', [])
    normalized = [normalize_slug(h) for h in team]
    filtered = [h for h in normalized if h in valid_slugs]
    entry['team'] = filtered
    fixed_teamups.append(entry)
with open(TEAMUPS_PATH, 'w', encoding='utf-8') as f:
    json.dump(fixed_teamups, f, indent=2)
print(f"Processed {len(fixed_teamups)} teamups entries.")

# 3. Convert each matchup file from array to slug-keyed dict with numeric fields
# AND BUNDLE ALL MATCHUPS INTO A SINGLE FILE
all_matchups_data = {} # New dictionary to hold all matchups

for fname in os.listdir(MATCHUPS_DIR):
    if not fname.endswith('_matchups.json'):
        continue
    path = os.path.join(MATCHUPS_DIR, fname)
    
    hero_slug_from_filename = fname.replace('_matchups.json', '')
    current_hero_slug = normalize_slug(hero_slug_from_filename)

    if current_hero_slug not in valid_slugs:
        print(f"Warning: hero slug '{current_hero_slug}' from filename {fname} not in valid_slugs. Skipping.")
        continue

    with open(path, 'r', encoding='utf-8') as f:
        try:
            data_from_file = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON from {fname}: {e}. Skipping this file.")
            continue
    
    fixed_enemies = {}
    
    # Check if data_from_file is a list of dictionaries (original assumption)
    # or a dictionary itself (new assumption based on error)
    
    if isinstance(data_from_file, list):
        # This was the original logic, assuming each entry in the list is a dict
        for entry_dict in data_from_file:
            if not isinstance(entry_dict, dict):
                print(f"Warning: Expected a dictionary for an entry in {fname}, but got {type(entry_dict)}. Skipping entry.")
                continue
            enemy_slug = normalize_slug(entry_dict.get('enemy_hero', ''))
            if not enemy_slug: # Skip if enemy_hero is missing or empty after normalization
                print(f"Warning: Missing or empty 'enemy_hero' in an entry in {fname}. Skipping entry.")
                continue
            if enemy_slug not in valid_slugs:
                print(f"Warning: unknown enemy '{enemy_slug}' in {fname} for hero {current_hero_slug}. Skipping entry.")
                continue
            
            fixed_enemies[enemy_slug] = {
                'hero_class': entry_dict.get('hero_class'),
                'hero_wins': parse_int(entry_dict.get('hero_wins', 0)),
                'enemy_wins': parse_int(entry_dict.get('enemy_wins', 0)),
                'winrate': parse_num(entry_dict.get('winrate', 0)),
                'difference': parse_num(entry_dict.get('difference', 0)),
                'matches': parse_int(entry_dict.get('matches', 0))
            }
    elif isinstance(data_from_file, dict):
        # This handles the case where the JSON file is already a dictionary of enemy_slug: details
        for enemy_slug_from_key, entry_details in data_from_file.items():
            normalized_enemy_slug = normalize_slug(enemy_slug_from_key)
            if not normalized_enemy_slug:
                print(f"Warning: Invalid enemy slug key '{enemy_slug_from_key}' in {fname}. Skipping entry.")
                continue
            if normalized_enemy_slug not in valid_slugs:
                print(f"Warning: unknown enemy '{normalized_enemy_slug}' (from key '{enemy_slug_from_key}') in {fname} for hero {current_hero_slug}. Skipping entry.")
                continue
            if not isinstance(entry_details, dict):
                print(f"Warning: Expected a dictionary for details of '{enemy_slug_from_key}' in {fname}, but got {type(entry_details)}. Skipping entry.")
                continue

            fixed_enemies[normalized_enemy_slug] = {
                'hero_class': entry_details.get('hero_class'),
                'hero_wins': parse_int(entry_details.get('hero_wins', 0)),
                'enemy_wins': parse_int(entry_details.get('enemy_wins', 0)),
                'winrate': parse_num(entry_details.get('winrate', 0)),
                'difference': parse_num(entry_details.get('difference', 0)),
                'matches': parse_int(entry_details.get('matches', 0))
            }
    else:
        print(f"Warning: Unexpected data type {type(data_from_file)} in {fname}. Expected list or dict. Skipping file.")
        continue
            
    all_matchups_data[current_hero_slug] = fixed_enemies

# After processing all files, write the bundled all_matchups.json
all_matchups_output_path = os.path.join(BASE_DIR, 'all_matchups.json')
with open(all_matchups_output_path, 'w', encoding='utf-8') as f:
    json.dump(all_matchups_data, f, indent=2)
print(f"Bundled all matchups into: {all_matchups_output_path}, {len(all_matchups_data)} heroes.")

print("Static data normalization complete.")
