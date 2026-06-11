export interface ProjectMembership {
  project_id: string;
  role: 'manager' | 'technician' | 'viewer';
  project_name: string;
  project_code: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_org_admin: boolean;
  projects: ProjectMembership[];
}

export interface Item {
  id: string;
  item_no: string;
  description: string;
  specification: string | null;
  model: string | null;
  department: string | null;
  unit_price: number | null;
  currency: string | null;
  reorder_level: number;
  max_level: number | null;
  abc_class: 'A' | 'B' | 'C' | null;
  barcode: string | null;
  comments: string | null;
  custom: Record<string, any>;
  category_id: string | null;
  stock_on_hand: number;
  value_native: number | null;
  supplier: { id: string; name: string } | null;
  default_location: { id: string; code: string } | null;
  category: { id: string; name: string } | null;
  stock_by_location?: { location_id: string; location_code: string; quantity: number }[];
  custom_field_defs?: FieldDef[];
}

export interface FieldDef {
  id: string;
  category_id: string | null;
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect';
  is_required: boolean;
  help_text?: string | null;
  options: { value: string; label: string }[];
}

export interface Txn {
  id: string;
  type: 'receipt' | 'issue' | 'adjustment' | 'transfer' | 'write_off' | 'opening';
  item_id: string;
  item_no?: string;
  item_description?: string;
  quantity_delta: number;
  from_location_id: string | null;
  to_location_id: string | null;
  from_location_code?: string | null;
  to_location_code?: string | null;
  purpose: string | null;
  reference: string | null;
  reverses_txn_id: string | null;
  performed_by_name?: string;
  performed_at: string;
}

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface Lookup {
  id: string;
  code?: string;
  name?: string;
}
