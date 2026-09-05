import { createDemoState, applyCommand } from './domain.mjs';
import { createEnsService } from './ens-chain.mjs';
import { createRegistrationService } from './registration.mjs';
import { getReceipt } from './ens-receipt.mjs';
import { getRegistrationReceipt } from './registration-receipt.mjs';

// The public build has no credentialed server or shared mutable visitor state.
export function createBrowserRuntime({ens=createEnsService(),registration=createRegistrationService(),receipt=getReceipt,registrationReceipt=getRegistrationReceipt}={}) {
  let demo=createDemoState();
  return Object.freeze({
    async request(namespace,path,body) {
      if(namespace==='demo') {
        if(path==='/api/command') demo=applyCommand(demo,body);
        else if(path==='/api/reset') demo=createDemoState();
        else if(path!=='/api/state') throw new Error('Unsupported demo request.');
        return structuredClone(demo);
      }
      if(namespace==='ens') {
        if(path==='inspect') return ens.inspect(body);
        if(path==='prepare') return ens.prepare(body);
        if(path==='receipt') return receipt(body);
      }
      if(namespace==='registration') {
        if(path==='inspect') return registration.inspect(body);
        if(path==='prepare') return registration.prepare(body);
        if(path==='receipt') return registrationReceipt(body);
      }
      throw new Error('Unsupported public application request.');
    },
  });
}
