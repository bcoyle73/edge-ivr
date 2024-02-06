/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";

import { createActor, createMachine } from 'xstate';

const ivr = createMachine({
	id: 'ivr',
	context: {
	},
	initial: 'main_menu',
	states: {
	  main_menu: {
		entry: () => {
		},
		on: {
		  1: 'sales',
		  2: 'support',
		},
	  },
	  sales: {
		entry: () => {
		  // Add logic to connect to Sales team or play relevant information.
		},
		on: {
		  HANGUP: 'hangup',
		},
	  },
	  support: {
		entry: () => {
		  // Add logic to connect to Support team or play relevant information.
		},
		on: {
		  '1': 'billing',
		  '2': 'accountInformation',
		  HANGUP: 'hangup',
		},
	  },
	  billing: {
		entry: () => {
		  // Add logic to connect to Sales team or play relevant information.
		},
		on: {
		  HANGUP: 'hangup',
		},
	  },
	  accountInformation: {
		entry: () => {
		  // Add logic to connect to Sales team or play relevant information.
		},
		on: {
		  HANGUP: 'hangup',
		},
	  },
	  hangup: {
		type: 'final',
	  },
	},
  });

  async function getTwiMLForState(state) {
	const twiml = new VoiceResponse();
	const gather = twiml.gather({
		numDigits: 1,
		action: '/',
		method: 'POST',
		timeout: 60
	  });
  
	switch (state) {
	  case 'main_menu':
		gather.say('Welcome to the Twilio IVR. Press 1 for Sales, 2 for Support, or 3 for Billing.');
		break;
	  case 'sales':
		gather.say('You selected Sales. Connecting you to the Sales team.');
		// Add logic to connect to Sales team or play relevant information.
		break;
	  case 'support':
		gather.say('You selected support. Press 1 for Billing, 2 for Account Information');
		break;
	  case 'billing':
		gather.say('You selected Billing. Connecting you to the Billing team.');
		// Add logic to connect to Billing team or play relevant information.
		break;
	  case 'accountInformation':
		gather.say('You selected Account information. Connecting you to the account team.');
		break;
	  case 'hangup':
		// No TwiML is needed here since the call is ending.
		break;
	  default:
		gather.say("Sorry, I don't understand that choice.");
		twiml.redirect('/voice');
		break;
	}
  
	return twiml.toString(); // Convert the VoiceResponse to TwiML XML string
  }

export class MyDurableObject {
	constructor(state, env) {
		this.state = state;
	  }
  
	async fetch(request) {
		let url = new URL(request.url);
		console.log("DO command:", url.pathname);
		let ivrState = (await this.state.storage.get("state"));
		let list = (await this.state.storage.list());
		console.log("DO: current state");
		console.log(ivrState);
		console.log(list);
		
		switch (url.pathname) {
			case "/update":
			  ivrState = url.searchParams.get("newState");
			  await this.state.storage.put("state", ivrState);
			  console.log("DO: new state");
		      console.log(ivrState);
			  break;
			;
			case "/":
			  // Serves the current value.
			  break;
			default:
			  return new Response("Not found", { status: 404 });
		}
		return new Response(ivrState);
	}
  }
async function startIVR(env, restoredState, stub = "", CallSid = "") {
	const ivrActor = createActor(ivr, {
		snapshot: restoredState
	  });
	  
	// callback for state machines. On each state change store the new state
	ivrActor.subscribe(async(snapshot, env) => {
		console.log('Value:', snapshot.value);
		console.log("update this snapshot with");
		const persistedState = ivrActor.getPersistedSnapshot();
		console.log(persistedState);
		if (restoredState?.value === snapshot.value) {
			console.log("OG state....ignore")
		} else {
			console.log("update this snapshot with");
			const persistedState = ivrActor.getPersistedSnapshot();
			console.log(persistedState);
			// Durable Object
			let resp = await stub.fetch(`http://do/update?newState=${JSON.stringify(persistedState)}`)
			
			// KV
			//await env.SESSIONS.put("CallSid", JSON.stringify(persistedState));
		}
	});
	ivrActor.start();
	return ivrActor;
}

export default {
	async fetch(request, env, ctx) {
		// parse the POST from Twilio
		const requestBodyText = await request.text();
		// Parse the URL-encoded string into an object
		const parsedData = new URLSearchParams(requestBodyText);

		// Convert the object into JSON format
		const jsonData = JSON.stringify(Object.fromEntries(parsedData.entries()));
		const jsonBody = JSON.parse(jsonData);
		const {Digits, CallSid} = jsonBody;

		console.log(CallSid);
		let restoredState;
		let stub;
		// handle fetching state here 
    	// Durable Objects
		let id = env.IVR_STATE.idFromName(CallSid);
		stub = env.IVR_STATE.get(id);
		console.log("FETCH: go look up DB");
		let resp = await stub.fetch(request.url);
		console.log(stub);
		restoredState = await resp.text();

		// KV
		//restoredState = await env.SESSIONS.get(CallSid);

		
		console.log("restored state");
		console.log(restoredState);
		if (restoredState) {
			restoredState = JSON.parse(restoredState);
		}

		const ivrActor = await startIVR(env, restoredState, stub, CallSid);
		
		// Send DTMF tones as events into state machine
		if (Digits) {
			console.log("send the event", Digits);
			await ivrActor.send({type: Digits});
			console.log("digits sent")
		}		
		
		const twimlResponse = await getTwiMLForState(ivrActor.getSnapshot().value);
		
		// wrapping the response to the Worker request to let the state change callback do its thing
		const responsePromise = new Promise((resolve) => {
			setTimeout(() => {		
			  // Create the response using the 'state' value
			  const response = new Response(twimlResponse, {
				headers: { 'content-type': 'text/xml' },
			  });
		
			  resolve(response);
			}, 500); 
		  });
		
		  return responsePromise;
	},
};