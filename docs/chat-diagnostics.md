# Check native OpenSearch tool capability

On cmscompops02, run the following after deploying the current backend:

```bash
sudo -iu runner docker exec cmssdt-chat-backend \
  node server/chat/diagnose-search.mjs \
  CMSSW_20_1_CLANG_X_2026-11-16-2300 \
  cmssdt-ib-matrix-2968
```

This is a read-only test through the same native MCP endpoint, container,
Kerberos cache and CA trust as the chat. No model inference, cluster writes,
tool registrations or credentials are involved in the output.

The diagnostic prints the discovered SearchIndexTool schema and checks a
mapping, a one-document search, an aggregation, and (only when exposed in the
schema) the raw-response aggregation mode. It prints response shapes, timing,
and redacted errors, not source documents or ticket contents. Empty aggregation
output is flagged as unsupported/missing, never interpreted as zero failures.

If document search fails, inspect the exact redacted exception and argument
schema before changing the agent. If document search succeeds but aggregation
output is missing or fails, treat aggregation as an unavailable server
capability. A successful tool list alone does not validate either capability.

Native SearchIndexTool's query argument represents the complete search request
body. Tools that explicitly expose separate size/sort/aggregation parameters
retain their split-argument contract. Schema-declared string bodies are JSON
encoded. The final agent step requests an answer from evidence already obtained;
it is not permission to guess missing results or completion semantics.
