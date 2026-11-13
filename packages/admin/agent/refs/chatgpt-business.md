# Businesses in ChatGPT

The installation owner manages the listing, domain verification when offered, Persona verification, and optional Business Agent in [Business Hub](https://chatgpt.com/business-hub). Enter verification codes and upload identity documents in OpenAI’s verification flow.

After the website opts in, run `vitris chatgpt-business inspect --site . --json` in the website project. Review its issues and production canonical URLs. Copy `data.profile` to `admin.config.json` as `chatgptBusiness.profile` and add `chatgpt-business` to `modules`. The profile website and inquiry URL must match the installation’s exact public HTTPS website origin. Include only details intended for the public listing.

Apply `0014_chatgpt_business.sql` to this admin installation’s D1 database using its reviewed migration sequence. The Settings flow records claim, Persona verification, agent status, and the date the owner checked. It uses the installation’s existing session and same-origin write checks.

Analytics requests `attribution=chatgpt` through the existing scoped website API. The report uses a UTC window including today, with up to ten landing pages per source. Missing metrics display as unavailable. Production Leads displays attribution when the website backend exposes it. The website contract covers separate collector and inquiry migrations, consent, and crawler policy. Business Hub provides OpenAI’s aggregate insights.
