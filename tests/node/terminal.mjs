process.env.TERM='xterm'; // Deterministic synthetic terminal editing, independent of the harness console.
const observations=[];const record=(...args)=>observations.push(args);
import tty from 'node:tty';
import readline from 'node:readline';
import rlp from 'node:readline/promises';
import {PassThrough} from 'node:stream';
record('TTY',tty.isatty(0),tty.isatty(-1),tty.isatty('0'));
for(const sequence of ['a','A',' ','\r','\n','\t','\x7f','\x08','\x03','\x04','\x1b[A','\x1b[1;5D','\x1bOP','\x1b[24~','\x1bx','\x1b']){
 const input=new PassThrough();readline.emitKeypressEvents(input);
 input.on('keypress',(text,key)=>record('KEY',JSON.stringify([text,key.name,key.ctrl,key.shift,key.meta,key.sequence])));
 input.write(sequence);if(sequence==='\x1b')await new Promise(r=>setTimeout(r,600));input.end();
}
{
 const input=new PassThrough(),output=new PassThrough(),lines=[],events=[];let text='';output.on('data',b=>text+=b);
 const rl=readline.createInterface({input,output,terminal:false});rl.on('line',line=>lines.push(line));rl.on('pause',()=>events.push('pause'));rl.on('close',()=>events.push('close'));
 const closed=new Promise(r=>rl.on('close',r));input.write('a\r');input.write('\nb\nc');input.end();await closed;record('LINES',JSON.stringify([lines,events,text]));
}
{
 const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',b=>text+=b);const rl=rlp.createInterface({input,output,terminal:false});
 const answer=rl.question('question?');input.write('answer\n');record('ANSWER',await answer,text);rl.close();input.end();
}
{
 const input=new PassThrough(),rl=rlp.createInterface({input,terminal:false}),controller=new AbortController();const pending=rl.question('abort',{signal:controller.signal});controller.abort('stop');
 try{await pending;}catch(e){record('ABORT',e.name,e.code,e.cause);}rl.close();input.end();
}
{
 const input=new PassThrough(),rl=readline.createInterface({input,crlfDelay:Infinity});const values=[];const job=(async()=>{for await(const line of rl)values.push(line);})();input.end('one\ntwo\nlast');await job;record('ITER',JSON.stringify(values));
}


{
 const output=new PassThrough();let text='';output.on('data',b=>text+=b);
 const returns=[readline.cursorTo(output,2),readline.cursorTo(output,1,3),readline.moveCursor(output,-2,3),readline.clearLine(output,-1),readline.clearLine(output,0),readline.clearLine(output,1),readline.clearScreenDown(output)];
 await new Promise(r=>setImmediate(r));record('CURSOR',text,returns);
}
{
 const input=new PassThrough(),output=new PassThrough(),rl=readline.createInterface({input,output,terminal:true});const lines=[];
 rl.on('line',line=>lines.push(line));rl.write('ab');rl.write(null,{name:'left'});rl.write('X');rl.write(null,{name:'return'});rl.write(null,{name:'up'});rl.write(null,{name:'return'});
 record('EDIT',lines,rl.history,rl.getPrompt());rl.close();input.end();
}
console.log('NODE_COMPAT_RESULT '+JSON.stringify(observations));
