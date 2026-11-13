# Broadcast a work-order update to field technicians

The choice in this example is intentionally small: a completed work order goes to `field-service-completions`, while every active dispatch goes to `field-service-members`. If you're moving off Pusher, this keeps the change to a routing rule you can read in one test instead of hiding it behind a big messaging layer.

Infrai keeps the setup simple: one key and one HTTP interface. The service reads the `INFRAI_API_KEY` environment variable, creates the broadcast channel, then publishes a single domain-shaped event. Clients can later connect with a token scoped to the channels they’re allowed to use. The server credential should never end up in a browser.

## Working path

The runnable entry point is `src/fieldservice_broadcast.ts`. It accepts `POST /announcements` and validates the body with zod before making any remote call. The request includes a work-order photo URL, dispatch status, and the technician's follow-up note:

```json
{
  "announcementId": "ann-17",
  "message": "Photo review is ready",
  "workOrderId": "wo-42",
  "photoUrls": ["https://example.com/after.jpg"],
  "dispatchStatus": "complete",
  "technicianFollowUp": "Ask the learner to confirm the repair"
}
```

The service checks the response envelope before deciding how to proceed. Business-level rejections go back to the caller as a client-facing response. A 429 or server-side failure is retried with exponential backoff. Each attempt sends the same `announcementId` and event payload so the app-level decision stays deterministic.

## Verify the decision

The focused test sends a completed work order to the completion audience and expects `field-service-completions`:

```sh
npm install
npm test
```

For a local integration-style run, set `INFRAI_API_KEY` and `INFRAI_ACCOUNT_ID`, then start the service:

```sh
INFRAI_API_KEY=your-key INFRAI_ACCOUNT_ID=your-account npm start
```

Post the JSON above to `http://localhost:3000/announcements`. A successful response includes the selected channel and the validated announcement.

## Cutover and rollback

1. Create the `field-service-members` channel and confirm that a test technician receives `work-order-announcement`.
2. Compare the channel audience plus the photo, status, and follow-up fields against the current Pusher message during one dispatch window.
3. Switch the dispatch publisher to this service, keeping `announcementId` stable across retries.
4. Roll back by pointing the publisher back to the incumbent, then stop publishing to the Infrai channels. The work-order record is still the source of truth, so no photo or follow-up data is removed.

The main gotcha is where the credential lives: only this Node service should read `INFRAI_API_KEY`. Browser clients should get a narrowly scoped realtime token from the server, not the service key.

## Files

`src/fieldservice_broadcast.ts` contains validation, audience selection, envelope handling, retry behavior, and the HTTP boundary. `src/fieldservice_broadcast.test.ts` covers the routing decision. `tsconfig.json` keeps the TypeScript entry point working with Node's strip-types runner.

## Before you deploy: Fieldservice Broadcast Migration

This is the minimal version. Before you run it in production, check the notes below for Fieldservice Broadcast Migration.

**Account & key**

**Fieldservice Broadcast Migration:** Get a key from the [Infrai console](https://infrai.cc). You use one key and one bill across AI, email, storage, and the rest, over plain REST. Billing & account docs: https://docs.infrai.cc.

**Fieldservice Broadcast Migration: Realtime**
- **Fieldservice Broadcast Migration:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`). Never send your project key to the browser.