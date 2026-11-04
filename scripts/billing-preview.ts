import {createBillingPair} from '../tests/billing-fixture.ts';
const preview=await createBillingPair({sellerPort:4394,clientPort:4395});
console.log(`Business billing dashboard: ${preview.seller.origin}/#billing`);
console.log(`Client admin billing: ${preview.client.origin}/#account-billing`);
console.log('Choose Open local demo in each installation. All records and actions are synthetic; no Stripe account, email, or charge is involved.');
console.log('The client sees only Alder & Stone. Changes appear in both views after refreshing billing. Records reset when this preview stops.');
const close=()=>{void preview.dispose().then(()=>process.exit(0));};process.once('SIGINT',close);process.once('SIGTERM',close);
await new Promise(()=>{});
