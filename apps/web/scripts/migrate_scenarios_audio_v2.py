import json
from pathlib import Path

root = Path(r'd:/projects/CTYK/apps/web/.scenarios')
files = sorted(root.glob('*/versions/*.json'))


def migrate_art(t: str) -> str:
    return 'ENRICHED_TRANSCRIPT' if t == 'STRUCTURED_FEATURES' else t


def uniq(existing, base):
    if base not in existing:
        return base
    i = 1
    while f"{base}_{i}" in existing:
        i += 1
    return f"{base}_{i}"

changed = 0
for fp in files:
    payload = json.loads(fp.read_text(encoding='utf-8'))
    sc = payload.get('scenario') or {}
    sid = sc.get('id', '')
    steps = sc.get('steps') or []
    edges = sc.get('edges') or []

    # normalize steps
    for st in steps:
        st['scenarioId'] = sid
        st['requires'] = [migrate_art(x) for x in (st.get('requires') or [])]
        st['produces'] = [migrate_art(x) for x in (st.get('produces') or [])]
        mid = st.get('moduleId')
        if mid == 'REPORT_OUTPUT':
            st['requires'] = []
        elif mid == 'ASR':
            st['requires'] = ['AUDIO_PREPARED']
        elif mid == 'PSYCH_STATE':
            st['requires'] = ['SPEAKER_SEGMENTS', 'AUDIO_PREPARED']
        elif mid == 'AUDIO_PREPARE':
            st['requires'] = ['AUDIO']
            st['produces'] = ['AUDIO_PREPARED']
        elif mid in {'AUDIO_FROM_UPLOAD', 'AUDIO_FROM_URL', 'AUDIO_FROM_API', 'AUDIO_FROM_RTSP'}:
            st['requires'] = ['AUDIO_SOURCE']
            st['produces'] = ['AUDIO']

    id_set = {s.get('id','') for s in steps}
    code_set = {s.get('code','') for s in steps}

    has_source = any(s.get('moduleId') == 'AUDIO_FROM_UPLOAD' for s in steps)
    has_prepare = any(s.get('moduleId') == 'AUDIO_PREPARE' for s in steps)
    has_asr = any(s.get('moduleId') == 'ASR' for s in steps)
    has_psych = any(s.get('moduleId') == 'PSYCH_STATE' for s in steps)

    min_order = min([int(s.get('orderHint') or 1) for s in steps] or [1])

    if (has_asr or has_psych or has_prepare) and not has_source:
        nid = uniq(id_set, 'step_audio_source_migrated'); id_set.add(nid)
        ncode = uniq(code_set, 'audio_upload'); code_set.add(ncode)
        steps.insert(0, {
            'id': nid,
            'scenarioId': sid,
            'moduleId': 'AUDIO_FROM_UPLOAD',
            'code': ncode,
            'orderHint': max(1, min_order - 2),
            'config': {},
            'requires': ['AUDIO_SOURCE'],
            'produces': ['AUDIO'],
        })
        has_source = True

    if (has_asr or has_psych) and not has_prepare:
        nid = uniq(id_set, 'step_audio_prepare_migrated'); id_set.add(nid)
        ncode = uniq(code_set, 'audio_prepare'); code_set.add(ncode)
        steps.insert(0, {
            'id': nid,
            'scenarioId': sid,
            'moduleId': 'AUDIO_PREPARE',
            'code': ncode,
            'orderHint': max(1, min_order - 1),
            'config': {},
            'requires': ['AUDIO'],
            'produces': ['AUDIO_PREPARED'],
        })
        has_prepare = True

    # normalize edges
    for e in edges:
        e['scenarioId'] = sid
        e['artifactTypeId'] = migrate_art(e.get('artifactTypeId',''))

    step_by_mod = {}
    for s in steps:
        step_by_mod.setdefault(s.get('moduleId'), []).append(s)

    def ensure_edge(from_id, to_id, art):
        for e in edges:
            if e.get('fromStepId') == from_id and e.get('toStepId') == to_id and e.get('artifactTypeId') == art:
                return
        edges.append({
            'id': f"edge_migr_{len(edges)+1}",
            'scenarioId': sid,
            'fromStepId': from_id,
            'toStepId': to_id,
            'artifactTypeId': art,
        })

    sources = step_by_mod.get('AUDIO_FROM_UPLOAD', [])
    prepares = step_by_mod.get('AUDIO_PREPARE', [])
    asrs = step_by_mod.get('ASR', [])
    psychs = step_by_mod.get('PSYCH_STATE', [])

    if sources and prepares:
        ensure_edge(sources[0]['id'], prepares[0]['id'], 'AUDIO')

    if prepares:
        p = prepares[0]['id']
        for a in asrs:
            ensure_edge(p, a['id'], 'AUDIO_PREPARED')
        for ps in psychs:
            ensure_edge(p, ps['id'], 'AUDIO_PREPARED')

    psych_ids = {s['id'] for s in psychs}
    edges = [e for e in edges if not (e.get('toStepId') in psych_ids and e.get('artifactTypeId') == 'TEXT')]

    sc['steps'] = steps
    sc['edges'] = edges
    payload['scenario'] = sc

    fp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    changed += 1

print(f'migrated {changed} files')
