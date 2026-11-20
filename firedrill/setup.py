import json, subprocess, sys
AGENT = '245a70ba-645f-4d9f-bae6-78698b4bff1a'
def fd(*args, stdin=None):
    r = subprocess.run(['firedrill', *args, '--json'], input=stdin, capture_output=True, text=True)
    out = [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith('{')]
    if r.returncode: print('ERR', args[:3], r.stderr[-600:] or r.stdout[-600:])
    return out
def save(kind, obj):
    out = fd('library', 'save', '--kind', kind, '--file', '-', stdin=json.dumps(obj))
    for o in out:
        d = o.get('data', {})
        if isinstance(d, dict) and (d.get('version') or d.get('digest') or d.get('version_id')):
            v = d.get('version', d)
            ref = {'origin': 'native_library', 'kind': kind, 'id': v.get('id') or v.get('version_id') or d.get('version_id'), 'revision': v.get('revision', 1), 'digest': v.get('digest') or v.get('content_digest')}
            print(kind, obj['name'], '->', ref['id'], ref['revision'], str(ref['digest'])[:12]); return ref
    print('UNPARSED', kind, json.dumps(out)[:700]); sys.exit(1)
shoppers = [
 ('Dutch shopper, earbuds', 'A shopper in the Netherlands who wants open-ear earbuds from the brand soundcore.', 'Hi, I live in the Netherlands and I want to buy soundcore aerofit 2 earbuds.', ['Lives in the Netherlands', 'Wants the soundcore AeroFit 2']),
 ('French shopper, laser module', 'A maker in France who found a laser module on the German shop of xTool.', 'Hello, I live in France. I want this one: https://de.xtool.com/products/xtool-m1-ultra-20w-module-kit', ['Lives in France', 'Found the product on the German xTool shop']),
 ('German shopper, AirPods', 'A shopper in Germany looking for cheap AirPods.', 'I live in Germany and I want to buy apple airpods pro 2.', ['Lives in Germany', 'Wants Apple AirPods Pro 2 as cheap as possible']),
]
ev = save('evaluation', {'schema': 'firedrill.native-evaluation.v1', 'name': 'Country Switch acts by the rules', 'description': 'Checks what the shopping agent did, not how nice the reply sounds.', 'method': 'rubric', 'criteria': [
  'The reply states one clear outcome: either a cart was filled at a named webshop with a cart link, or no cart was filled. It never claims both.',
  'When no cart is filled, the reply gives the reason and quotes a numbered rule.',
  'The buyer country named in the reply matches the country the user said they live in.',
  'The agent never says it paid or will pay; payment is left to the shopper.',
  'The agent does not offer a product from a seller that is not the brand\'s own webshop.'], 'evidence': ['conversation'], 'threshold': 75})
refs = []
for name, desc, first, facts in shoppers:
    p = save('persona', {'schema': 'firedrill.native-persona.v1', 'name': name, 'description': desc, 'goals': ['Get a filled cart for the product at the best brand shop that delivers to my country, or a clear reason why not'], 'constraints': ['Will not pay inside the chat', 'Only says where they live and what they want'], 'communication': 'Short and practical. One or two sentences.', 'initial_message': first, 'memory_facts': facts})
    s = save('scenario', {'schema': 'firedrill.native-scenario.v1', 'name': name, 'description': desc, 'instruction': 'Send your first message exactly. Read the answer. If it gives a cart link or a clear refusal with a reason, say thanks and stop. Do not ask for anything else.', 'personas': [p], 'evaluations': [ev], 'conditions': [], 'events': [], 'max_turns': 2, 'stop_rules': ['Stop once the agent gave a cart link or clearly refused with a reason.']})
    refs.append(s)
w = fd('world', 'save', '--agent', AGENT, '--file', '-', stdin=json.dumps({'schema': 'firedrill.native-world.v1', 'name': 'Shoppers in three countries', 'description': 'Simulated shoppers in the Netherlands, France and Germany ask the agent for different products.', 'dependencies': [], 'resources': refs, 'configuration_names': [], 'execution': {'repetitions': 1, 'max_parallel': 1, 'reset': 'per_drill'}}))
print('WORLD', json.dumps(w)[:900])
