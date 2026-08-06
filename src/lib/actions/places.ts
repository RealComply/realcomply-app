"use server";

// Address autocomplete for the property-creation form, via Google's Places
// API (New) — Autocomplete endpoint. Restricted to Australia since every
// property this app handles is NSW. The API key is a server-only secret
// (GOOGLE_PLACES_API_KEY, no NEXT_PUBLIC_ prefix) — this action is the only
// thing that ever calls Google directly, so the key never reaches the
// browser. If the key isn't configured yet, this quietly returns no
// suggestions rather than breaking the form: the address field still works
// as a plain text input either way.
//
// Docs: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete

export type AddressSuggestion = {
  placeId: string;
  text: string;
};

type PlacePrediction = {
  placeId?: string;
  text?: { text?: string };
};

type AutocompleteResponse = {
  suggestions?: Array<{ placePrediction?: PlacePrediction }>;
};

export async function searchAddress(query: string): Promise<AddressSuggestion[]> {
  const input = query.trim();
  if (input.length < 3) return [];

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ["au"],
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      }),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as AutocompleteResponse;
    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is PlacePrediction & { placeId: string; text: { text: string } } =>
        Boolean(p?.placeId && p?.text?.text),
      )
      .map((p) => ({ placeId: p.placeId, text: p.text.text }));
  } catch {
    // Network hiccup or malformed response — fail quietly, same as a
    // missing key. Plain typing always still works.
    return [];
  }
}
