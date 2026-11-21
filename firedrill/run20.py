import json, subprocess, re, sys, time
AG='245a70ba-645f-4d9f-bae6-78698b4bff1a'
res=None
for l in open('/tmp/claude-501/world20.json'):
    if l.strip().startswith('{'):
        d=json.loads(l).get('data',{}); r=(d.get('definition') or {}).get('resources')
        if r: res=r
def sh(args, inp=None):
    r=subprocess.run(args,input=inp,capture_output=True,text=True); return r.stdout+r.stderr
def log(*a):
    print(*a, flush=True)
camps=[]
for b in range(4):
    part=res[b*5:(b+1)*5]
    out=sh(['firedrill','world','save','--agent',AG,'--file','-','--json'], json.dumps({'schema':'firedrill.native-world.v1','name':f'Shoppers batch {b+1} of 4','description':'Five simulated shoppers in European countries ask the agent for different products.','dependencies':[],'resources':part,'configuration_names':[],'execution':{'repetitions':1,'max_parallel':1,'reset':'per_drill'}}))
    wid=(re.search(r'"world_id": ?"([0-9a-f-]{36})"',out) or [None,None])[1]
    p=sh(['firedrill','plan','--world',wid,'--json'])
    pid=None; err=None
    for l in p.splitlines():
        if l.startswith('{'):
            o=json.loads(l)
            if o.get('type')=='plan': pid=o['data']['id']; err=o['data'].get('estimate_error')
    log('BATCH',b+1,'world',wid,'plan',pid,'err',err)
    if not pid or err: log('STOP: no estimate'); break
    a=sh(['firedrill','apply',pid,'--approve','--follow','--json'])
    cid=(re.search(r'"campaign_id": ?"([0-9a-f-]{36})"',a) or re.search(r'campaign[^0-9a-f]{1,40}([0-9a-f]{8}-[0-9a-f-]{27})',a) or [None,None])[1]
    log('APPLY tail', a[-500:].replace('\n',' '), 'campaign', cid)
    if not cid: log('STOP: no campaign'); break
    camps.append(cid); open('campaigns20.txt','a').write(cid+'\n')
    r=sh(['firedrill','run','--plan','plan.json','--descriptor','descriptor.json','--campaign',cid,'--approve','--json'])
    log('RUN tail', r[-400:].replace('\n',' '))
    log(sh(['firedrill','report',cid])[:900])
log('DONE', camps)
