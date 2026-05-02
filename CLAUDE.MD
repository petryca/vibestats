# VIBESTATS – website visitor tracking app

Design and code a basic visitor tracking application that can be used on any static website by placing a script tag on the page.

## Requirements

 - no need for a user login/logout a single stats page can be publicly accesible
 - a single page with data, responsive
 - hard coded array of domains. if script is linked from a diffrent domain it does not measure and opens an alert
 - stats from a specific website can be accessed by going to (ecample: vibestats.com/myweb.cz/ )
 - measures daily visitors
 - measures visitors vs page views
 - measures country, os, browser
 - measures referrer including search term if any
 
## Technology
 
 - free app hosting such as railway.com combined with supabase.com
 - framework: express.js
 - client side framework for the dataview: D3 for charts, svelte.js
 
## Note
 
if you can come up with a better architecture and technology then sugested above, please propose, I am looking for most minimalist solution
