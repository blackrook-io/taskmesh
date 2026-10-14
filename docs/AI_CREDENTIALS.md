# AI provider keys (Administrators)

This guide covers the encryption key that protects stored AI provider keys, how to rotate it, what a backup restore needs, and where a rejected provider key shows up.

In the app: **Administration → System properties** for instance keys. Each user sets their own provider key under **Assistant settings**.

---

## The encryption key

`AI_CREDENTIALS_KEY` encrypts two kinds of secrets at rest:

- **Instance keys** — one provider key for the whole TaskMesh install, stored by an Administrator.
- **User keys** — a provider key saved by an individual user.

The plaintext provider key is not stored. TaskMesh keeps AES-256-GCM ciphertext plus the last four characters as a hint. The encryption key itself lives only in the environment. It is not a system property, and it is not written into a backup.

Generate a value of at least 32 characters and put it in `.env` (never commit it):

```bash
openssl rand -base64 48
```

```env
AI_CREDENTIALS_KEY=…
```

Restart TaskMesh after changing `.env`. Startup refuses a value shorter than 32 characters. This key is separate from `OAUTH_CREDENTIALS_KEY` and `MFA_TOTP_KEY`.

Set it before storing the first instance or user key. Without it, TaskMesh will not save a provider key.

Deprecated environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AZURE_OPENAI_API_KEY`) are a fallback when no instance key is stored for that plugin. They are not encrypted with `AI_CREDENTIALS_KEY` and they are not in the database.

---

## Rotate the encryption key

Rotation re-encrypts every stored instance key and user key under a new passphrase. The provider secrets themselves do not change. The script does not edit `.env` and does not restart the process.

1. Generate the next key (`openssl rand -base64 48`). Leave the current `AI_CREDENTIALS_KEY` in place.
2. Add it beside the current key:

   ```env
   AI_CREDENTIALS_KEY_NEXT=…
   ```

3. From the TaskMesh checkout, dry-run first. This decrypts every stored key and writes nothing:

   ```bash
   npm run ai:rotate-credentials-key
   ```

4. When the dry run reports only the rows you expect and no decrypt failures, write the new ciphertext:

   ```bash
   npm run ai:rotate-credentials-key -- --apply
   ```

5. Copy the next value into `AI_CREDENTIALS_KEY`. Remove `AI_CREDENTIALS_KEY_NEXT`. Restart TaskMesh.

If any row cannot be decrypted, the script writes nothing and prints the plugin id (and user id, for a user key). It never prints the provider secret or the ciphertext. Fix the current `AI_CREDENTIALS_KEY` so it matches the key that encrypted those rows, then run the dry run again.

A backup taken before rotation still needs the **old** encryption key. A backup taken after a successful apply and restart needs the **new** one.

---

## Backups and restore

A backup is a database dump plus the uploads archive. Provider keys are inside the database dump as ciphertext. `AI_CREDENTIALS_KEY` is not in the archive.

After a restore:

- Put the `AI_CREDENTIALS_KEY` that was current when that backup was taken back into `.env`, then restart.
- If the key was rotated after that backup, the restored ciphertext still needs the key from backup time. You can rotate again once both keys are available: set the backup-time value as `AI_CREDENTIALS_KEY`, set the desired value as `AI_CREDENTIALS_KEY_NEXT`, and follow the rotation steps above.

The Backups page states that the encryption key is not part of the archive. It shows a warning when `AI_CREDENTIALS_KEY` is not set, because a later restore would not be able to decrypt stored provider keys.

---

## Rejected, expired, or revoked provider keys

When a provider rejects a stored key during **Verify** or during a live assistant call (expired, revoked, or otherwise unauthorized), TaskMesh stores a short redacted message and clears the verified mark. Rate limits, quota, network errors, and unknown models do not do this.

| Key | Where the message appears |
|-----|---------------------------|
| Instance key | Administration → System properties, on that provider |
| User key | That user's Assistant settings |

Replace the provider key, or run **Verify** after the vendor accepts it again. A successful Verify or a successful assistant call clears the message.

The environment-variable fallback is not a stored key, so a rejection of that fallback is not saved on the instance key row.
