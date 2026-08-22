export interface CatalogCategoryReference {
  id: string;
  name: string;
  path: string | null;
  isLeaf: boolean;
  isActive: boolean;
}

export interface CatalogAttributeOptionReference {
  id: string;
  value: string;
  displayValue: string;
  isActive: boolean;
}

export interface CatalogAttributeReference {
  id: string;
  displayName: string;
  inputType: string;
  isRequired: boolean;
  maxSelections: number | null;
  parentAttributeId: string | null;
  triggerOptionId: string | null;
  options?: CatalogAttributeOptionReference[];
}
