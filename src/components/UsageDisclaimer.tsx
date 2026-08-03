"use client";

interface UsageDisclaimerProps {
  /** True when the selected environment's host looks like Experience Edge delivery. */
  isLiveEdgeHost?: boolean;
  environmentName?: string;
}

/**
 * Standing advice about the cost of an export. This is not decoration: an
 * export is one Edge layout request per page, issued back to back, and on a
 * delivery host those requests share the organisation's 80 req/s budget with
 * live traffic.
 */
export function UsageDisclaimer({
  isLiveEdgeHost,
  environmentName,
}: UsageDisclaimerProps) {
  return (
    <div className="disclaimer" role="note">
      <strong>Before you run a large export</strong>
      <ul>
        <li>
          <strong>Run it during off-peak hours.</strong> Every selected page is
          one Edge layout request, sent one after another. A few hundred pages
          is a sustained burst against the same service your sites read from.
        </li>
        <li>
          <strong>Point the environment at the preview endpoint, not live.</strong>{" "}
          Use the CM host (
          <code>https://xmc-&lt;org&gt;-&lt;project&gt;-&lt;env&gt;.sitecorecloud.io</code>
          ), which this app calls at <code>/sitecore/api/graph/edge</code>.
          Experience Edge <em>delivery</em> is capped at <strong>80 requests
          per second for the whole organisation</strong> — an export pointed
          there competes with production traffic and can get you rate limited.
        </li>
        <li>
          Edge serves <strong>published</strong> content. The content tree reads{" "}
          <code>master</code>, so a page can be visible here and still export as
          empty if it has never been published.
        </li>
      </ul>

      {isLiveEdgeHost && (
        <p className="disclaimer-alert">
          ⚠ The host configured for
          {environmentName ? ` “${environmentName}”` : " this environment"} looks
          like an Experience Edge <strong>delivery</strong> host. Exports will
          count against your organisation&apos;s 80 req/s limit and may affect
          live sites. Switch it to the CM host unless you know you want this.
        </p>
      )}
    </div>
  );
}
