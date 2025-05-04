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
for fname in os.listdir(MATCHUPS_DIR):
    if not fname.endswith('_matchups.json'):
        continue
    path = os.path.join(MATCHUPS_DIR, fname)
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    fixed = {}
    for entry in data:
        enemy = normalize_slug(entry.get('enemy_hero', ''))
        if enemy not in valid_slugs:
            print(f"Warning: unknown enemy '{enemy}' in {fname}")
            continue
        fixed[enemy] = {
            'hero_class': entry.get('hero_class'),
            'hero_wins': parse_int(entry.get('hero_wins', 0)),
            'enemy_wins': parse_int(entry.get('enemy_wins', 0)),
            'winrate': parse_num(entry.get('winrate', 0)),
            'difference': parse_num(entry.get('difference', 0)),
            'matches': parse_int(entry.get('matches', 0))
        }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(fixed, f, indent=2)
    print(f"Fixed matchup file: {fname}, {len(fixed)} entries.")

print("Static data normalization complete.")
