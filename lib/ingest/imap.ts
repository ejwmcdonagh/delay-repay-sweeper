import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { RawEmail } from "../parsers/types.js";

export interface ImapConfig {
  user: string;
  host: string;
  port: number;
  password?: string; // app password — never an account password
  accessToken?: string; // OAuth2 (Gmail / M365); imapflow performs XOAUTH2
}

// Pulls message sources locally and parses them in-process; nothing about the mailbox leaves
// the machine. Lives outside the unit-tested core because it needs a live IMAP server —
// the parsing logic it feeds (registry + extract) is what carries the tests.
export async function fetchRecentEmails(cfg: ImapConfig, since: Date): Promise<RawEmail[]> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: cfg.accessToken ? { user: cfg.user, accessToken: cfg.accessToken } : { user: cfg.user, pass: cfg.password! },
    logger: false,
  });

  const out: RawEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const msg of client.fetch({ since }, { source: true })) {
        const parsed = await simpleParser(msg.source!);
        out.push({
          from: parsed.from?.text ?? "",
          subject: parsed.subject ?? "",
          body: parsed.text ?? "",
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out;
}
