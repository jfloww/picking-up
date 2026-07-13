export type TokenPair = {
  access: string;
  refresh: string;
};

export type CurrentUser = {
  id: number | string;
  email: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type AuthFormState = {
  error?: string;
};
