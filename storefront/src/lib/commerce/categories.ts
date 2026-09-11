import type { Category } from "@spree/sdk";
import { storefrontFetch } from "./config";
import { mapAwjCategoryToViewModel } from "./mappers";
import type {
  AwjCategory,
  AwjListResponse,
  AwjResourceResponse,
} from "./types";

export async function fetchCategories(): Promise<{ data: Category[] }> {
  const response =
    await storefrontFetch<AwjListResponse<AwjCategory>>("categories");

  return {
    data: response.data.map((category) =>
      mapAwjCategoryToViewModel(category, 0),
    ),
  };
}

export async function fetchCategory(id: string): Promise<Category> {
  const response = await storefrontFetch<AwjResourceResponse<AwjCategory>>(
    `categories/${id}`,
  );

  return mapAwjCategoryToViewModel(response.data, 0);
}
