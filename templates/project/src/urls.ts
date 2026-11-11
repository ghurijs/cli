// URL configuration (Django's urls.py). Add your apps with include(), e.g.
//   import { urlpatterns as blogUrls } from './blog/urls'
//   path('blog/', include(blogUrls)),
import { admin } from '@ghuri/admin'
import { include, path } from '@ghuri/core'
import { DefaultRouter } from '@ghuri/rest'
import type { Context } from 'hono'

/** REST API router: register viewsets here, e.g. `router.register('posts', PostViewSet)`. */
export const router = new DefaultRouter()

function home(c: Context) {
  return c.json({ project: '{{name}}', admin: '/admin/', api: '/api/' })
}

export const urlpatterns = [
  path('', home, { name: 'home' }),
  path('admin/', admin.site.urls),
  path('api/', include(router.urls)),
]
