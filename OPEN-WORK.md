# Open work — storage-studio-kh

What this app still owes, newest first. Open items only: shipped work lives in `CHANGELOG.md` and
`docs/receipts/<version>/RECEIPT.md`.

- [ ] **A saved-login mount, exercised** — the 0.1.31 code change lets NetAuth use a login already saved on the Mac instead of refusing a password-less mount, and it is written `not exercised — no NAS exists to test against`: the probe found no reachable share and the mount check printed four SKIPs naming that reason. **Next:** on a Mac with a reachable SMB share and a saved login, mount it through the app and record the outcome. Treat this as an untested path, not a defect.
- [ ] **A live self-update click-through** — `UNMEASURED`: the release, the appcast signature and the feed row are all proven, but no installed copy has been watched updating itself. **Next:** record the before/after version readback the next time one installs itself.
- [ ] **The idle footprint number** — `idle-footprint: UNMEASURED — no IDLE_PID in the gate config`, so no measured idle memory figure exists for a release. **Next:** set `IDLE_PID` in the next gate config and quote the measured number on that receipt.
