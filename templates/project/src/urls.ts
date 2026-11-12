// URL configuration (Django's urls.py). Add your apps with include(), e.g.
//   import { urlpatterns as blogUrls } from './blog/urls'
//   path('blog/', include(blogUrls)),
import { admin } from '@ghuri/admin'
import { include, path } from '@ghuri/core'
{{#if graphql}}
import { GraphQLView } from '@ghuri/graphql'
{{/if}}
import { DefaultRouter } from '@ghuri/rest'
import { serveMedia } from '@ghuri/storage'
import type { Context } from 'hono'

/** REST API router: register viewsets here, e.g. `router.register('posts', PostViewSet)`. */
export const router = new DefaultRouter()

function home(c: Context) {
{{#if graphql}}
  return c.json({ project: '{{name}}', admin: '/admin/', api: '/api/', graphql: '/graphql/' })
{{else}}
  return c.json({ project: '{{name}}', admin: '/admin/', api: '/api/' })
{{/if}}
}

export const urlpatterns = [
  path('', home, { name: 'home' }),
  path('admin/', admin.site.urls),
  path('api/', include(router.urls)),
{{#if graphql}}
  // GraphQL over HTTP; schema from GRAPHQL.SCHEMA (src/schema.ts).
  path('graphql/', GraphQLView.asView(), { name: 'graphql' }),
{{/if}}
  // Uploaded files (FileField / ImageField) from the default storage, at MEDIA_URL. With a public R2 bucket or
  // a CDN, set `publicUrl` on the storage and remove this.
  path('media/<path:name>', serveMedia(), { name: 'media' }),
]
