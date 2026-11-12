import { CASCADE, CharField, ForeignKey, IntegerField, Model } from '@ghuri/orm'

export class Author extends Model({
  name: new CharField({ maxLength: 100 }),
}) {}

export class Book extends Model({
  title: new CharField({ maxLength: 200 }),
  pages: new IntegerField({ default: 0 }),
  author: new ForeignKey(() => Author, { onDelete: CASCADE, relatedName: 'books' }),
}) {}
