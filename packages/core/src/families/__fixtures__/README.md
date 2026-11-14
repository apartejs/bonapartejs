# Reference chat templates

The chat template each family layer is checked against, byte for byte, by
rendering it with `@huggingface/jinja` in the family's tests.

| File | Origin |
|---|---|
| `gemma.jinja` | Gemma 4's chat template (Google), as llama.cpp ships it: `models/templates/google-gemma-4-31B-it.jinja`, llama.cpp commit `c83f305`. |

A template is copied verbatim: a fixture that was edited no longer says what
the model was trained on.
