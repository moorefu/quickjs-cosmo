import tty from 'node:tty';
import readline from 'node:readline';
import promises from 'node:readline/promises';
import * as os from 'qjs:os';
const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:false});
rl.question('name?',answer=>{const name:string=answer;void name;});
const iterator:AsyncIterable<string>=rl;
const pr=promises.createInterface({input:process.stdin});
const answer:Promise<string>=pr.question('name?',{signal:new AbortController().signal});
const ttyInput=new tty.ReadStream(0);ttyInput.setRawMode(true).setRawMode(false);
const ttyOutput=new tty.WriteStream(1);readline.cursorTo(ttyOutput,0);ttyOutput.clearLine(0);
os.ttySetRaw(0);os.ttySetRaw(0,false);os.read(0,new ArrayBuffer(4),0,4);
// @ts-expect-error The read buffer is required.
os.read(0,4);
// @ts-expect-error Completers are outside this subset.
readline.createInterface({input:process.stdin,completer:()=>[]});
// @ts-expect-error Only standard TTY descriptors can be constructed.
new tty.ReadStream(5);
// @ts-expect-error Transactional Readline is not implemented.
new promises.Readline(process.stdout);
void iterator;void answer;
