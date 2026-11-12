import { CASCADE, CharField, ForeignKey, IntegerField, ManyToManyField, Model, SET_NULL } from '@ghuri/orm'

export class Category extends Model({
  name: new CharField({ maxLength: 100, unique: true }),
}) {
  static Meta = { ordering: ['name'], verboseNamePlural: 'categories' }
}

export class Tag extends Model({
  name: new CharField({ maxLength: 50 }),
}) {}

export class Product extends Model({
  name: new CharField({ maxLength: 200 }),
  price: new IntegerField({ default: 0, helpText: 'In cents.' }),
  status: new CharField({
    maxLength: 10,
    default: 'draft',
    choices: [
      ['draft', 'Draft'],
      ['live', 'Live'],
    ],
  }),
  category: new ForeignKey(() => Category, { onDelete: CASCADE, relatedName: 'products' }),
  replacement: new ForeignKey('self', { onDelete: SET_NULL, null: true, blank: true }),
  tags: new ManyToManyField(() => Tag, { blank: true }),
}) {
  static Meta = {
    ordering: ['-price'],
    indexes: [{ fields: ['status', 'price'], name: 'shop_product_status_price' }],
    uniqueTogether: [['category', 'name']],
  }
}
