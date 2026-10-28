const result=await fetch('https://127.0.0.1:'+process.env.NODE_COMPAT_HTTPS_PORT+'/echo').then(async r=>{await r.arrayBuffer();return {status:r.status};},e=>({name:e.name,code:e.cause?.code}));
console.log('NODE_COMPAT_RESULT '+JSON.stringify(result));
