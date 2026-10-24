import assert from "node:assert/strict";
import test from "node:test";
import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { buildRawSesMessage, SesAdapter } from "../src/services/email/adapters/SesAdapter.js";

const message = {
  from: "MAIVW <noreply@test.maivw.com>",
  to: "client@example.com",
  subject: "Registro aprovado",
  text: "Seu domínio foi registrado.",
  html: "<p>Seu domínio foi registrado.</p>",
  nativeAttachments: [{
    filename: "proof.txt",
    content: Buffer.from("on-chain-proof"),
    contentType: "text/plain",
  }],
  largeAttachments: [],
};

test("SesAdapter sends raw MIME through the ECS task role SDK path", async () => {
  let captured: any;
  const adapter = new SesAdapter({
    region: "us-east-1",
    configurationSet: "maivw-staging-ses-events",
  }, {
    async send(command: SendEmailCommand) {
      captured = command.input;
      return { MessageId: "ses-message-123" };
    },
  });

  const result = await adapter.sendEmail(message);
  assert.equal(result.success, true);
  assert.equal(result.provider, "aws_ses");
  assert.equal(result.messageId, "ses-message-123");
  assert.equal(captured.ConfigurationSetName, "maivw-staging-ses-events");
  assert.equal(captured.Destination.ToAddresses[0], "client@example.com");
  const raw = Buffer.from(captured.Content.Raw.Data).toString("utf8");
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /filename="proof.txt"/);
});

test("SES MIME builder removes header line breaks", () => {
  const raw = Buffer.from(buildRawSesMessage({
    ...message,
    subject: "Normal\r\nBcc: attacker@example.com",
  })).toString("utf8");
  assert.doesNotMatch(raw, /\r\nBcc:/);
});
