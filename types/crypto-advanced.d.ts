declare module 'node:crypto' {
    import {Buffer,BufferEncoding} from 'node:buffer';
    import {Transform,TransformOptions} from 'node:stream';
    export type AsymmetricType='ed25519'|'x25519';
    export interface PrivateKeyInput {key:BinaryLike;format?:'pem'|'der';type?:'pkcs8';encoding?:BufferEncoding;}
    export interface PublicKeyInput {key:BinaryLike|KeyObject;format?:'pem'|'der';type?:'spki'|'pkcs8';encoding?:BufferEncoding;}
    export interface PublicKeyEncoding {format:'der'|'pem';type:'spki';}
    export interface PrivateKeyEncoding {format:'der'|'pem';type:'pkcs8';}
    export class KeyObject {
        private constructor();
        readonly type:'secret'|'public'|'private';readonly symmetricKeySize:number|undefined;
        readonly asymmetricKeyType:AsymmetricType|undefined;readonly asymmetricKeyDetails:Record<string,never>|undefined;
        equals(other:KeyObject):boolean;
        export():Buffer;
        export(options:{format:'der';type:'pkcs8'|'spki'}):Buffer;
        export(options:{format?:'pem';type:'pkcs8'|'spki'}):string;
    }
    export function createSecretKey(key:BinaryLike,encoding?:BufferEncoding):KeyObject;
    export function createPrivateKey(key:BinaryLike|PrivateKeyInput):KeyObject;
    export function createPublicKey(key:BinaryLike|KeyObject|PublicKeyInput):KeyObject;
    type EncodedKey<T>=T extends {format:'der'}?Buffer:T extends {format:'pem'}?string:KeyObject;
    export function generateKeyPairSync<P extends PublicKeyEncoding|undefined=undefined,S extends PrivateKeyEncoding|undefined=undefined>(
        type:AsymmetricType,options?:{publicKeyEncoding?:P;privateKeyEncoding?:S}
    ):{publicKey:EncodedKey<P>;privateKey:EncodedKey<S>};
    export type SignKey=KeyObject|BinaryLike|PrivateKeyInput|{key:KeyObject};
    export type VerifyKey=KeyObject|BinaryLike|PublicKeyInput;
    /** Ed25519 uses null/undefined; named digests are rejected. */
    export function sign(algorithm:string|null|undefined,data:BinaryLike,key:SignKey):Buffer;
    export function sign(algorithm:string|null|undefined,data:BinaryLike,key:SignKey,callback:(error:Error|null,signature:Buffer)=>void):void;
    export function verify(algorithm:string|null|undefined,data:BinaryLike,key:VerifyKey,signature:BinaryLike):boolean;
    export function verify(algorithm:string|null|undefined,data:BinaryLike,key:VerifyKey,signature:BinaryLike,callback:(error:Error|null,valid:boolean)=>void):void;
    export interface DiffieHellmanOptions {privateKey:KeyObject;publicKey:KeyObject;}
    export function diffieHellman(options:DiffieHellmanOptions):Buffer;
    export function diffieHellman(options:DiffieHellmanOptions,callback:(error:Error|null,secret:Buffer)=>void):void;
    export interface CipherOptions extends TransformOptions {authTagLength?:number;}
    export interface CipherAADOptions {encoding?:BufferEncoding;plaintextLength?:number;}
    export interface CipherMethods {
        update(data:BinaryLike,inputEncoding?:BufferEncoding):Buffer;
        update(data:BinaryLike,inputEncoding:BufferEncoding|undefined,outputEncoding:'buffer'):Buffer;
        update(data:BinaryLike,inputEncoding:BufferEncoding|undefined,outputEncoding:BufferEncoding):string;
        final():Buffer;final(outputEncoding:'buffer'):Buffer;final(outputEncoding:BufferEncoding):string;
        setAAD(data:BinaryLike,options?:CipherAADOptions):this;
        setAutoPadding(autoPadding?:boolean):this;
    }
    export interface Cipheriv extends CipherMethods {}
    export class Cipheriv extends Transform {
        constructor(algorithm:string,key:BinaryLike|KeyObject,iv:BinaryLike|null,options?:CipherOptions);
        getAuthTag():Buffer;
    }
    export interface Decipheriv extends CipherMethods {}
    export class Decipheriv extends Transform {
        constructor(algorithm:string,key:BinaryLike|KeyObject,iv:BinaryLike|null,options?:CipherOptions);
        setAuthTag(tag:BinaryLike,encoding?:BufferEncoding):this;
    }
    export function createCipheriv(algorithm:string,key:BinaryLike|KeyObject,iv:BinaryLike|null,options?:CipherOptions):Cipheriv;
    export function createDecipheriv(algorithm:string,key:BinaryLike|KeyObject,iv:BinaryLike|null,options?:CipherOptions):Decipheriv;
    export function getCiphers():string[];
    export interface AdvancedCryptoMethods {
        KeyObject:typeof KeyObject;createSecretKey:typeof createSecretKey;createPrivateKey:typeof createPrivateKey;createPublicKey:typeof createPublicKey;
        generateKeyPairSync:typeof generateKeyPairSync;sign:typeof sign;verify:typeof verify;diffieHellman:typeof diffieHellman;
        Cipheriv:typeof Cipheriv;Decipheriv:typeof Decipheriv;createCipheriv:typeof createCipheriv;createDecipheriv:typeof createDecipheriv;getCiphers:typeof getCiphers;
    }
}
