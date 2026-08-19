---
icon: lucide/rocket
---

# Get started

For full documentation visit [zensical.org](https://zensical.org/docs/).

``` mermaid
graph
  A[Start] --> B{Error?};
  B -->|Yes| C[Hmm...];
  C --> D[Debug];
  D --> B;
  B ---->|No| E[Yay!];
```
