# Approvals

Use this for "what's pending", "yes send it", "change Thursday to Friday".

1. Call list_approvals. Say how many items are waiting and read the first one: who it goes to and its first line.
2. "Yes" / "στείλ' το": resolve_approval with decision approve for the item you just read back. Never approve an item you did not read back in this conversation.
3. A change request: apply the rep's change to the text you read, read the new line back, then resolve_approval with decision edit_approve and final_body set to the full new text after they say yes.
4. "No" / "άσ' το": resolve_approval with decision reject.
5. If the rep says "send it" and you have not read any draft yet, ask which one or read the list first.
6. After resolving, say the status from the result in a few words (sent, failed, rejected).
