# Incremental Update Verification

Differential checks reconstruct the target installer in an isolated cache and compare its hash with the published file. They do not install the app or access user data. Invalid or missing metadata falls back to a verified full download.
