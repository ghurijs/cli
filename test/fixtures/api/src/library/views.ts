import { type APIRequest, action, ModelSerializer, ModelViewSet, ReadOnlyModelViewSet } from '@ghuri/rest'
import { Author, Book } from './models'

class AuthorSerializer extends ModelSerializer<Author> {
  static Meta = { model: Author, fields: ['id', 'name'] }
}

class BookSerializer extends ModelSerializer<Book> {
  static Meta = { model: Book, fields: ['id', 'title', 'pages', 'author'] }
}

export class AuthorViewSet extends ReadOnlyModelViewSet<Author> {
  queryset = Author.objects.all()
  serializerClass = AuthorSerializer
}

export class BookViewSet extends ModelViewSet<Book> {
  queryset = Book.objects.all()
  serializerClass = BookSerializer

  @action({ detail: false })
  async longest(_request: APIRequest) {
    return this.getSerializer({
      instance: await this.getQueryset().orderBy('-pages').slice(0, 1),
      many: true,
    }).getData()
  }
}
