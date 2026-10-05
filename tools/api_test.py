# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

import urllib.request, json, ssl
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
B='http://127.0.0.1:8791'
def req(path, method='GET', body=None):
    r = urllib.request.Request(B+path, method=method,
        data=json.dumps(body).encode() if body else None,
        headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=10, context=ctx) as resp:
            return resp.status, resp.read().decode()[:400]
    except Exception as e:
        return 'ERR', str(e)[:200]

out=[]
out.append(str(req('/api/health')))
out.append(str(req('/api/pair','POST',{'pairCode':'ABCD-2345','deviceId':'dev_test1','create':True})))
prog={'revision':1,'createdAt':1,'updatedAt':2,'totalPracticeSeconds':600,'streakDays':3,
 'lastPracticeDate':'2026-10-04','lessons':{},'sections':{},'sessions':[],'totalStars':2,
 'profile':{'displayName':'测试','level':1,'dailyGoalMinutes':30,'preferredInput':'onScreen'}}
out.append(str(req('/api/progress','POST',{'pairCode':'ABCD-2345','deviceId':'dev_test1','progress':prog})))
out.append(str(req('/api/progress?pairCode=ABCD-2345&deviceId=dev_test1')))
out.append(str(req('/api/pair','POST',{'pairCode':'ABCD-2345','deviceId':'dev_test2'})))
prog2=dict(prog); prog2['revision']=1; prog2['totalPracticeSeconds']=900; prog2['streakDays']=5
out.append(str(req('/api/progress','POST',{'pairCode':'ABCD-2345','deviceId':'dev_test2','progress':prog2})))
out.append(str(req('/api/progress?pairCode=ABCD-2345&deviceId=dev_test1')))
out.append(str(req('/api/pair','POST',{'pairCode':'bad','deviceId':'x'})))
out.append('HTML=' + str(req('/')[0]) + ' len=' + str(len(req('/')[1])))

with open(r'D:\workbodyW\pinao\_api_test.txt','w',encoding='utf-8') as f:
    f.write('\n\n'.join(out))
print('done')
