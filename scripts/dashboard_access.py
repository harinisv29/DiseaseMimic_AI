"""Local demo browser access boundary. No assessment data is stored here."""
import os
import secrets
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
ALLOWED={'http://localhost:5173','http://127.0.0.1:5173'}
SESSIONS={}
TTL=max(60,min(7200,int(os.environ.get('DISEASEMIMIC_SESSION_SECONDS','1800'))))
def issue_session():
    now=time.monotonic()
    for key in list(SESSIONS):
        if SESSIONS[key]<now:SESSIONS.pop(key,None)
    token=secrets.token_urlsafe(32);SESSIONS[token]=now+TTL
    return {'token':token,'expiresInSeconds':TTL}
class LocalBrowserBoundary(BaseHTTPMiddleware):
    async def dispatch(self,request:Request,call_next):
        origin=request.headers.get('origin')
        if origin and origin not in ALLOWED:
            return JSONResponse({'detail':'Untrusted browser origin'},status_code=403)
        protected=request.method=='POST' and request.url.path in {'/rank','/dashboard/phenotypes/search','/dashboard/terms'}
        if origin and protected:
            token=request.headers.get('x-assessment-session','')
            if SESSIONS.get(token,0)<time.monotonic():
                return JSONResponse({'detail':'Local browser session expired'},status_code=401,headers={'Access-Control-Allow-Origin':origin})
            SESSIONS[token]=time.monotonic()+TTL
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        return response
