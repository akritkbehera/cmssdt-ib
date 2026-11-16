# Kerberos authentication for IB Insights

Deployment on cmscompops02 defaults to Kerberos for OpenSearch. CERN OIDC login still protects access to the chat backend, but no OpenSearch token exchange occurs. All users query OpenSearch as the principal in the dedicated server cache, not as their individual CERN identity. The model key and login client secret stay server-side.

## Initial login and manual refresh

On cmscompops02, enter a shell as the runner account:

```bash
sudo -iu runner
umask 077
mkdir -p "$HOME/.local/share/cmssdt-chat/krb5"
chmod 700 "$HOME/.local/share/cmssdt-chat/krb5"
kinit -c "FILE:$HOME/.local/share/cmssdt-chat/krb5/ccache" akbehera@CERN.CH
klist -c "FILE:$HOME/.local/share/cmssdt-chat/krb5/ccache"
exit
```

Enter your password only into the interactive kinit prompt. Repeat kinit with this same cache path when expired. No redeployment or container restart is required. Do not use the default personal /tmp cache.

The deployment mounts the dedicated cache directory into /run/cmssdt-krb5; mounting the directory ensures replacement cache files from kinit are visible. The runtime UID matches runner (Podman keep-id), and the private directory is relabeled for this container. Kerberos libraries may update service tickets, so the cache mount is writable. The application does not parse or log ticket bytes.

The image includes Debian curl with GSSAPI and krb5-user. Curl performs SPNEGO directly against the fixed CERN MCP URL with TLS verification, no redirects, bounded output, timeout and cancellation. Requests never pass passwords or ticket contents in arguments.

## Verification

Open IB Insights, sign in with CERN, then Test MCP connection. Successful tools/list is the actual proof of authenticated MCP connectivity; health only reports configuration. Initially only ListIndexTool is registered on this cluster.

Missing/expired/rejected tickets produce an instruction to refresh the backend cache. Refreshing requires interactive login; no automatic credential renewal or reboot persistence is claimed.

Set the github-pages environment variable OPENSEARCH_AUTH_MODE=oidc to restore the original per-user token-exchange path. Default is kerberos.

The temporary HTTPS certificate remains independent of Kerberos; its browser trust/expiry still needs management.
