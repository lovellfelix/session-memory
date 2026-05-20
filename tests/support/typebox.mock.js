export const Type = {
  Object: value => value,
  Optional: value => value,
  String: value => value ?? {},
  Number: value => value ?? {},
  Boolean: value => value ?? {},
}
