## ❌ Hydration Proof: 5 pages failed

Tested 7 pages (5 routes) in 12.3s with hydration-proof 1.2.3 · chromium 153.0 · production and development builds.

- 6 issues at or above "error" severity.

| Result | Count |
| --- | ---: |
| Pages tested | 7 |
| Passed | 1 |
| Passed with warnings | 1 |
| Failed | 4 |
| Could not be tested | 1 |
| Error issues | 6 |
| Warning issues | 2 |
| Info issues | 1 |
| Ignored issues | 1 |

### Pages with problems

| Status | Route | Scenario | Mode | Errors | Warnings |
| --- | --- | --- | --- | ---: | ---: |
| Failed | `/products/1?ref=a,b` | `guest` | production | 2 | 1 |
| Failed | `/nasty` | `guest` | production | 1 | 0 |
| Not tested | `/broken` | `guest` | production | 1 | 0 |
| Failed | `/products/1?ref=a,b` | `admin` | production | 1 | 0 |
| Failed | `/products/1?ref=a,b` | `guest` | development | 1 | 0 |
| Warnings | `/docs` | `guest` | production | 0 | 1 |

### Issues

<details>
<summary><strong>HP9004</strong> The page could not be loaded · <code>/broken</code> · guest · production</summary>

- **Severity:** error (100% confidence)
- **Pages:** `/broken`
- **Scenarios:** `guest`
- **Builds:** production
- **Docs:** [HP9004](https://hydration.jscrate.dev/docs/issues/hp9004)

net::ERR\_CONNECTION\_REFUSED at http://127.0.0.1:4173/broken

</details>

<details>
<summary><strong>HP1001</strong> Text differs between server and client · <code>/products/1?ref=a,b</code> · guest, admin · production, development</summary>

- **Severity:** error (95% confidence)
- **Pages:** `/products/1?ref=a,b`
- **Scenarios:** `guest`, `admin`
- **Builds:** production, development
- **Element:** `#price`
- **Component:** `Price`
- **Likely cause:** [Time-dependent value](https://hydration.jscrate.dev/docs/causes/time) (97% confidence)
- **Source:** [`apps/web/src/app/products/[id]/page.tsx:12:7`](https://github.com/acme/shop/blob/0123456789abcdef0123456789abcdef01234567/apps/web/src/app/products/%5Bid%5D/page.tsx#L12)
- **Fix:** Move time-dependent values into useEffect.
- **Fix:** Pass the time from the server.
- **Docs:** [HP1001](https://hydration.jscrate.dev/docs/issues/hp1001)

**Server:**

```text
Price: 10%
now
```

**Client:**

```text
Price: 12%\u000d
later
```

```text
  11 | return (
> 12 |   <p id="price">{price}</p>
     |       ^
```

</details>

<details>
<summary><strong>HP1013</strong> dangerouslySetInnerHTML differs between server and client · <code>/nasty</code> · guest · production</summary>

- **Severity:** error (85% confidence)
- **Pages:** `/nasty`
- **Scenarios:** `guest`
- **Builds:** production
- **Element:** `div[data-x="a\|b"] > p:nth-child(2)`
- **Source:** [`apps/web/src/app/nasty/page.tsx:40`](https://github.com/acme/shop/blob/0123456789abcdef0123456789abcdef01234567/apps/web/src/app/nasty/page.tsx#L40)
- **Fix:** Sanitize &lt;html&gt; &amp; use \`useEffect\` \| done.
- **Docs:** [HP1013](https://hydration.jscrate.dev/docs/issues/hp1013)

**Server:**

````text
100% ]]></failure><x a="1" b='2'>&amp; | `tick` ``` a:b,c \u0000\u0007\u0008\u000b\u000c\u001b\u007f\u0085\u009f 🎉 \ud800 end\u000d
next
````

**Client:**

`````text
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx````yyyyyyyyyy
`````

</details>

<details>
<summary><strong>HP1004</strong> Class name differs between server and client · <code>/products/1?ref=a,b</code> · guest · production</summary>

- **Severity:** error (70% confidence)
- **Pages:** `/products/1?ref=a,b`
- **Scenarios:** `guest`
- **Builds:** production
- **Element:** `main > button.btn` attribute `class`
- **Likely cause:** CSS-in-JS class names differ (60% confidence)
- **Source:** [`packages/ui/src/Button.tsx:3`](https://github.com/acme/shop/blob/0123456789abcdef0123456789abcdef01234567/packages/ui/src/Button.tsx#L3)
- **Docs:** [HP1004](https://hydration.jscrate.dev/docs/issues/hp1004)

**Server:**

```text
btn a:b,c
```

**Client:**

```text
btn <x>
```

</details>

<details>
<summary><strong>HP9010</strong> The route redirected somewhere else · <code>/docs</code> · guest · production</summary>

- **Severity:** warning (90% confidence)
- **Pages:** `/docs`
- **Scenarios:** `guest`
- **Builds:** production
- **Docs:** [HP9010](https://hydration.jscrate.dev/docs/issues/hp9010)

The route /docs ended on /login.

</details>

<details>
<summary><strong>HP1005</strong> Attribute only present in the server HTML · <code>/products/1?ref=a,b</code> · guest · production</summary>

- **Severity:** warning (60% confidence)
- **Pages:** `/products/1?ref=a,b`
- **Scenarios:** `guest`
- **Builds:** production
- **Element:** `input[name="q"]` attribute `data-lastpass`
- **Source:** not found. The scripts have no source maps.
- **Docs:** [HP1005](https://hydration.jscrate.dev/docs/issues/hp1005)

**Server:**

```text
on
```

**Client:** (absent)

</details>

<details>
<summary><strong>HP3003</strong> Duplicate id attribute · <code>/nasty</code> · guest · production</summary>

- **Severity:** info (50% confidence)
- **Pages:** `/nasty`
- **Scenarios:** `guest`
- **Builds:** production
- **Element:** `#main`
- **Docs:** [HP3003](https://hydration.jscrate.dev/docs/issues/hp3003)

Two elements use id="main" 🎉.

</details>

---

Full report: `apps/web/.hydration-proof/report/report.html`. Upload `apps/web/.hydration-proof/report` with `actions/upload-artifact` to find it in the [run artifacts](https://github.com/acme/shop/actions/runs/42#artifacts).
