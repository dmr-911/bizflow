# Localization

## Structure

```
src/lib/i18n/
  en.ts      English dictionary — source of truth for keys
  bn.ts      Bangla dictionary — typed as Dictionary, so missing keys fail the build
  index.ts   getDictionary(locale), interpolate(), LOCALES
src/lib/format.ts   money / date / number formatting per locale
```

- Server components get the dictionary from `getContext()` / `pageContext()` (`t.customers.title`).
- Client components use `useI18n()` from `components/i18n-provider.tsx`.
- Placeholders use `{name}` and are filled with `interpolate()`.
- `tests/i18n.test.ts` checks that every language has exactly the English keys.

The interface language is a business setting (sidebar selector or **Settings → Language & formats**) and also controls the language of printed documents.

## Formatting

| What | English | Bangla |
| --- | --- | --- |
| BDT | ৳1,500.50 | ১,৫০০.৫০৳ (bn-BD) |
| USD | $1,500.50 | ১,৫০০.৫০$ |
| Dates | per setting: `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `DD MMM YYYY` | same formats with Bangla digits and month names |

Amount inputs accept both ASCII and Bangla digits and ignore `,`, `৳` and `$`.

## Adding a language

1. Copy `bn.ts` to e.g. `hi.ts`, translate the values, export `hi: Dictionary`.
2. Register it in `index.ts` (`dictionaries` and `LOCALES`) and extend `Locale`.
3. Add the code to `settingsSchema.locale` in `src/lib/validation.ts`.
4. If it needs different number formatting, extend `formatMoney` / `makeFormatter`.

## Known limitation

Activity-log messages are stored as English text when the event happens, so they are not translated when the language changes. Customer-entered content (names, descriptions, terms) is shown exactly as typed.
