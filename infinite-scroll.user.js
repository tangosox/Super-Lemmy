// ==UserScript==
// @name         Lemmy Infinite Scroll
// @namespace    paul-lemmy
// @version      0.3
// @description  Append-only infinite scrolling for Lemmy
// @include      /^https:\/\/lemmy\.[^/]+\/.*/
// @require      https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* global markdownit */

(function () {
    'use strict';

    const postBodies = new Map();
    let loading = false;
    let finished = false;
    let sentinel = null;
    let scrollObserver = null;
    let activePostContainer = null;
    let activePageKey = null;
    let pageGeneration = 0;

    /*
     * Cursor representing the NEXT page we need to load.
     *
     * On page 1 there is no pageCursor in the URL, so we obtain
     * the next cursor from Lemmy's API first.
     */
    let nextCursor = null;

    function getPostContainer() {
        return document.querySelector('.post-listings');
    }

    function getCurrentOptions() {
        const params = new URLSearchParams(location.search);

        const communityMatch = location.pathname.match(/^\/c\/([^/]+)/);

        return {
            sort: params.get('sort') || 'Active',
            listingType: params.get('listingType') || 'All',
            pageCursor: params.get('pageCursor'),
            community: communityMatch
            ? decodeURIComponent(communityMatch[1])
            : null
        };
    }

    /*
     * Ask Lemmy's API for a page solely so we can obtain its
     * next_page cursor.
     *
     * We use the browser's existing Lemmy authentication.
     */
    async function getNextCursor(cursor = null) {
        const options = getCurrentOptions();

        const params = new URLSearchParams({
            limit: '20',
            sort: options.sort,
            saved_only: 'false',
            type_: options.listingType,
            show_hidden: 'false'
        });

        if (cursor) {
            params.set('page_cursor', cursor);
        }

        if (options.community) {
            params.set('community_name', options.community);
            params.delete('type_');
        }

        const response = await fetch(
            `/api/v3/post/list?${params}`,
            {
                credentials: 'include'
            }
        );

        if (!response.ok) {
            throw new Error(
                `API returned HTTP ${response.status}`
            );
        }

        const data = await response.json();

        // Cache Markdown bodies and link preview descriptions.
        for (const view of data.posts ?? []) {
            postBodies.set(view.post.id, {
                body: view.post.body ?? '',
                embedDescription: view.post.embed_description ?? '',
                url: view.post.url ?? ''
            });
        }

        return data.next_page || null;
    }

    /*
     * Download an ordinary Lemmy HTML page without navigating
     * the browser to it.
     */
    async function fetchPage(cursor) {
        const options = getCurrentOptions();

        const params = new URLSearchParams({
            dataType: 'Post',
            listingType: options.listingType,
            pageCursor: cursor,
            sort: options.sort
        });

        const response = await fetch(
            `${location.pathname}?${params}`,
            {
                credentials: 'include'
            }
        );

        if (!response.ok) {
            throw new Error(
                `Page returned HTTP ${response.status}`
            );
        }

        const html = await response.text();

        return new DOMParser().parseFromString(
            html,
            'text/html'
        );
    }

    function appendPosts(doc) {
        const currentContainer = getPostContainer();
        const newContainer =
              doc.querySelector('.post-listings');

        if (!currentContainer || !newContainer) {
            throw new Error(
                'Could not find .post-listings'
            );
        }

        /*
         * Import exactly what Lemmy rendered inside the new
         * post-listings container: posts, separators, etc.
         */
        const fragment =
              document.createDocumentFragment();

        [...newContainer.children].forEach(child => {
            const imported = document.importNode(child, true);

            if (imported.classList?.contains('post-listing')) {
                imported.dataset.superLemmyImported = 'true';
            }

            fragment.appendChild(imported);
        });

        enableImportedImageExpansion(fragment);

        // Open linked thumbnails in new tabs on appended pages.
        fragment.querySelectorAll('a.thumbnail[href]').forEach(link => {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });

        currentContainer.appendChild(fragment);
    }

    async function loadMore() {
        if (loading || finished) {
            return;
        }

        loading = true;
        const generation = pageGeneration;

        try {
            /*
             * First invocation:
             *
             * Current DOM already contains page 1. Ask the API
             * what cursor represents page 2.
             */
            if (!nextCursor) {
                nextCursor = await getNextCursor(
                    getCurrentOptions().pageCursor
                );
            }

            if (generation !== pageGeneration) return;

            if (!nextCursor) {
                finished = true;
                return;
            }

            console.log(
                '[Infinite Scroll] Loading',
                nextCursor
            );

            /*
             * Fetch page 2/3/etc as HTML, but DO NOT navigate.
             */
            const doc = await fetchPage(nextCursor);
            if (generation !== pageGeneration) return;

            /*
             * Append it to what is already on screen.
             */
            appendPosts(doc);

            /*
             * Ask the API what comes after the page we just
             * appended.
             */
            const loadedCursor = nextCursor;

            const followingCursor = await getNextCursor(loadedCursor);
            if (generation !== pageGeneration) return;
            nextCursor = followingCursor;

            console.log(
                '[Infinite Scroll] Loaded.',
                'Next cursor:',
                nextCursor
            );

            if (!nextCursor) {
                finished = true;
            }

        } catch (error) {
            console.error(
                '[Infinite Scroll]',
                error
            );
        } finally {
            if (generation === pageGeneration) loading = false;
        }
    }

    function enableImageResize(wrapper) {
        const link = wrapper.querySelector('a');
        const img = link?.querySelector('img.img-expanded');

        if (link) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        if (!link || !img || img.dataset.superLemmyResizable) return;
        img.dataset.superLemmyResizable = 'true';

        img.style.maxWidth = 'none';
        img.style.setProperty('max-height', 'none', 'important');
        img.style.height = 'auto';
        img.style.userSelect = 'none';
        img.draggable = false;

        function setInitialSize() {
            if (img.dataset.superLemmyManuallyResized === 'true') return;

            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;
            if (!naturalWidth || !naturalHeight) return;

            const postColumn = img.closest('.post-listings');
            const rightEdge = postColumn
            ? postColumn.getBoundingClientRect().right
            : document.documentElement.clientWidth;

            const availableWidth = Math.max(
                100,
                rightEdge - img.getBoundingClientRect().left - 20
            );

            const maxInitialHeight = window.innerHeight * 0.65;
            const scale = Math.min(
                1,
                availableWidth / naturalWidth,
                maxInitialHeight / naturalHeight
            );

            img.style.width = `${naturalWidth * scale}px`;
        }

        if (img.complete && img.naturalWidth) {
            setInitialSize();
        } else {
            img.addEventListener('load', setInitialSize, { once: true });
        }

        let startX = 0;
        let startWidth = 0;
        let pointerDown = false;
        let resized = false;
        let suppressClick = false;

        const threshold = 5;

        img.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;

            pointerDown = true;
            resized = false;
            startX = event.clientX;
            startWidth = img.getBoundingClientRect().width;

            img.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        img.addEventListener('pointermove', event => {
            if (!pointerDown) return;

            const delta = event.clientX - startX;

            if (!resized && Math.abs(delta) < threshold) return;

            resized = true;
            suppressClick = true;
            img.dataset.superLemmyManuallyResized = 'true';

            img.style.width =
                `${Math.max(100, startWidth + delta)}px`;
        });

        function finish(event) {
            if (!pointerDown) return;

            pointerDown = false;

            if (img.hasPointerCapture(event.pointerId)) {
                img.releasePointerCapture(event.pointerId);
            }
        }

        img.addEventListener('pointerup', finish);
        img.addEventListener('pointercancel', finish);

        link.addEventListener('click', event => {
            if (!suppressClick) return;

            event.preventDefault();
            event.stopPropagation();
            suppressClick = false;
        }, true);
    }

    function enableImportedImageExpansion(container) {
        const buttons = container.querySelectorAll(
            'button.thumbnail[aria-label="Expand here"]'
        );

        buttons.forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                const post = button.closest('.post-listing');
                const picture = button.querySelector('picture');
                const img = picture?.querySelector('img');

                if (!post || !picture || !img) return;

                const existing = post.querySelector(
                    '.super-lemmy-expanded-image'
                );

                if (existing) {
                    existing.remove();
                    button.setAttribute('aria-label', 'Expand here');
                    button.setAttribute('data-tippy-content', 'Expand here');
                    return;
                }

                const expandedPicture = picture.cloneNode(true);
                const expandedImg = expandedPicture.querySelector('img');

                // Post's original media link, not its locally cached thumbnail.
                const originalLink = [...post.querySelectorAll('a[href]')]
                .find(a => {
                    if (a.closest('button.thumbnail, .super-lemmy-expanded-image')) return false;
                    try {
                        const url = new URL(a.href, location.href);
                        return /^https?:$/.test(url.protocol) &&
                            /\.(?:png|jpe?g|gif|webp|avif)$/i.test(url.pathname);
                    } catch {
                        return false;
                    }
                });
                const originalUrl = originalLink?.href || img.src;

                // A cloned <picture> retains the thumbnail's source candidates.
                // Remove them so the browser actually loads the original URL.
                expandedPicture.querySelectorAll('source').forEach(source => source.remove());
                expandedImg.removeAttribute('srcset');
                expandedImg.src = originalUrl;

                expandedImg.classList.remove(
                    'thumbnail',
                    'rounded',
                    'object-fit-cover'
                );

                expandedImg.classList.add(
                    'img-expanded',
                    'slight-radius'
                );

                const wrapper = document.createElement('div');
                wrapper.className =
                    'offset-sm-3 my-2 d-none d-sm-block super-lemmy-expanded-image';

                const link = document.createElement('a');
                link.className = 'd-inline-block';
                link.href = originalUrl;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';

                link.appendChild(expandedPicture);
                wrapper.appendChild(link);

                post.appendChild(wrapper);
                enableImageResize(wrapper);

                button.setAttribute('aria-label', 'Collapse here');
                button.setAttribute('data-tippy-content', 'Collapse here');
            });
        });
    }

    function setup() {
        const postContainer = getPostContainer();
        const paginator = document.querySelector('.paginator');
        const pageKey = location.pathname + location.search;

        // No listing on post/comment pages. Discard the old observer
        // and reset state so the next listing begins at page one.
        if (!postContainer || !paginator) {
            if (activePostContainer || scrollObserver || sentinel) {
                scrollObserver?.disconnect();
                sentinel?.remove();
                scrollObserver = null;
                sentinel = null;
                activePostContainer = null;
                activePageKey = null;
                pageGeneration++;
                loading = false;
                finished = false;
                nextCursor = null;
            }
            return;
        }

        // DOM changes from appended posts must NOT create another sentinel.
        if (postContainer === activePostContainer &&
            pageKey === activePageKey &&
            sentinel?.isConnected &&
            scrollObserver) return;

        scrollObserver?.disconnect();
        sentinel?.remove();
        pageGeneration++;
        loading = false;
        finished = false;
        nextCursor = null;
        activePostContainer = postContainer;
        activePageKey = pageKey;

        sentinel = document.createElement('div');
        sentinel.id = 'lemmy-infinite-scroll-sentinel';
        sentinel.style.height = '2px';
        paginator.after(sentinel);

        scrollObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadMore();
        }, { rootMargin: '0px', threshold: 1 });

        scrollObserver.observe(sentinel);
    }

    /*
    * Enable resizing for native Lemmy expansions,
    * including images on the original first page.
    */
    function observeExpandedImages() {
        const initialize = () => {
            document.querySelectorAll('img.img-expanded').forEach(img => {
                const wrapper = img.closest(
                    '.super-lemmy-expanded-image, .offset-sm-3'
                );

                if (wrapper) {
                    enableImageResize(wrapper);
                }
            });
        };

        initialize();

        let setupScheduled = false;
        const observer = new MutationObserver(() => {
            initialize();
            if (setupScheduled) return;
            setupScheduled = true;
            requestAnimationFrame(() => {
                setupScheduled = false;
                setup();
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    observeExpandedImages();
    setup();

    /*
    * Open post, community, and user links in new tabs.
    * Preserve the infinite-scroll feed in the original tab.
    */
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0) return;

        // Preserve standard browser modifier-key behavior.
        if (event.ctrlKey || event.metaKey ||
            event.shiftKey || event.altKey) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const link = target.closest('a[href]');
        if (!link) return;

        // Only affect links within post listings.
        if (!link.closest('.post-listings')) return;

        const url = new URL(link.href, location.href);

        // Only internal Lemmy links.
        if (url.origin !== location.origin) return;

        const isPost = /^\/post\/\d+(?:\/|$)/.test(url.pathname);
        const isCommunity = /^\/c\/[^/]+/.test(url.pathname);
        const isUser = /^\/u\/[^/]+/.test(url.pathname);

        if (!isPost && !isCommunity && !isUser) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        window.open(url.href, '_blank', 'noopener');
    }, true);

    /*
 * Open direct image links in new tabs.
 * Handles both original and infinite-scroll posts.
 */
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0) return;

        if (event.ctrlKey || event.metaKey ||
            event.shiftKey || event.altKey) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const link = target.closest('a[href]');
        if (!link || !link.closest('.post-listings')) return;

        const url = new URL(link.href, location.href);

        const isImage = /\.(jpg|jpeg|png|gif|webp|avif)(?:$|[?#])/i
        .test(url.href);

        if (!isImage) return;

        // Set the link itself to open in a new tab.
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        // Let the browser handle the click normally.
    }, true);
    // Open all linked post thumbnails in new tabs.
    function openThumbnailLinksInNewTabs(container) {
        container.querySelectorAll('a.thumbnail[href]').forEach(link => {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });
    }

    // Handle thumbnails on the original page.
    openThumbnailLinksInNewTabs(document);

    /*
 * ============================================================
 * Voting for infinite-scroll posts
 * ============================================================
 */

    const votingInProgress = new WeakSet();

    function getJwt() {
        const cookie = document.cookie
        .split('; ')
        .find(c => c.startsWith('jwt='));

        return cookie
            ? decodeURIComponent(cookie.slice(4))
        : null;
    }

    function getPostId(post) {
        const link = post.querySelector('a[href*="/post/"]');
        const match = link?.pathname.match(/^\/post\/(\d+)/);

        return match ? Number(match[1]) : null;
    }

    async function postApi(path, options = {}) {
        const token = getJwt();

        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(`/api/v3/${path}`, {
            ...options,
            credentials: 'include',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            throw new Error(`Lemmy API returned ${response.status}`);
        }

        return response.json();
    }

    function updatePostVoteDisplay(post, view) {
        const score = post.querySelector('.vote-bar .post-score');
        const up = post.querySelector(
            '.vote-bar button[aria-label="Upvote"]'
        );
        const down = post.querySelector(
            '.vote-bar button[aria-label="Downvote"]'
        );

        if (!score || !up || !down) return;

        const vote = view.my_vote ?? 0;

        score.textContent = view.counts.score;

        up.setAttribute('aria-pressed', String(vote === 1));
        down.setAttribute('aria-pressed', String(vote === -1));

        up.classList.toggle('super-lemmy-voted', vote === 1);
        down.classList.toggle('super-lemmy-voted', vote === -1);
        if (vote !== 1) {
            up.classList.remove('text-info');
            up.classList.add('text-muted');
        }

        if (vote !== -1) {
            down.classList.remove('text-danger');
            down.classList.add('text-muted');
        }

        const tooltip =
              `${view.counts.upvotes} Upvotes · ` +
              `${view.counts.downvotes} Downvotes`;

        for (const el of [score, up, down]) {
            el.setAttribute('data-tippy-content', tooltip);
        }
    }

    document.addEventListener('click', async event => {
        const target = event.target;

        if (!(target instanceof Element)) return;

        const button = target.closest(
            '.vote-bar button[aria-label="Upvote"], ' +
            '.vote-bar button[aria-label="Downvote"]'
        );

        if (!button) return;

        const post = button.closest(
            '.post-listing[data-super-lemmy-imported="true"]'
        );

        if (!post) return;

        event.preventDefault();
        event.stopPropagation();

        if (votingInProgress.has(post)) return;

        const postId = getPostId(post);
        if (!postId) return;

        votingInProgress.add(post);

        try {
            // Retrieve the actual current vote state.
            const current = await postApi(`post?id=${postId}`);
            const previousVote = current.post_view.my_vote ?? 0;

            const clickedVote =
                  button.getAttribute('aria-label') === 'Upvote'
            ? 1
            : -1;

            // Clicking the same vote again removes it.
            const newVote =
                  previousVote === clickedVote ? 0 : clickedVote;

            const result = await postApi('post/like', {
                method: 'POST',
                body: JSON.stringify({
                    post_id: postId,
                    score: newVote
                })
            });

            updatePostVoteDisplay(post, result.post_view);

        } catch (error) {
            console.error('[Super Lemmy] Voting failed:', error);
        } finally {
            votingInProgress.delete(post);
        }
    }, true);


    /*
    * ============================================================
    * Expand post bodies on infinite-scroll pages
    * Uses cached Markdown instead of downloading full HTML pages.
    * ============================================================
    */
    const postMarkdownRenderer = markdownit({
        html: false,
        linkify: true,
        breaks: true
    });

    async function getPostBody(postId) {
        if (postBodies.has(postId)) {
            return postBodies.get(postId);
        }

        const response = await fetch(`/api/v3/post?id=${postId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Post API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const post = data.post_view?.post;

        if (!post) {
            throw new Error('Post data not found');
        }

        const content = {
            body: post.body ?? '',
            embedDescription: post.embed_description ?? ''
        };

        postBodies.set(postId, content);
        return content;
    }

    document.addEventListener('click', async event => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const button = target.closest('.post-title > button');
        if (!button) return;

        const post = button.closest(
            '.post-listing[data-super-lemmy-imported="true"]'
        );
        if (!post) return;

        const layout = button.closest(
            '.d-none.d-sm-block, .d-block.d-sm-none'
        );
        const title = button.closest('.post-title');

        if (!layout || !title) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        function setIcon(expanded) {
            const use = button.querySelector('svg use');
            if (!use) return;

            const href = use.getAttribute('href') ||
                  use.getAttribute('xlink:href');

            if (!href) return;

            const updated = href.replace(
                /#icon-(?:plus|minus)-square$/,
                expanded ? '#icon-minus-square' : '#icon-plus-square'
            );

            use.setAttribute('href', updated);
            use.setAttribute('xlink:href', updated);
        }

        // Already rendered: show or hide without another request.
        const existing = layout.querySelector(
            '.super-lemmy-post-body'
        );

        if (existing) {
            const expanding = existing.hidden;
            existing.hidden = !expanding;
            setIcon(expanding);
            return;
        }

        // Prevent simultaneous requests from repeated clicks.
        if (button.dataset.superLemmyLoading === 'true') return;
        button.dataset.superLemmyLoading = 'true';

        try {
            const link = post.querySelector('a[href*="/post/"]');
            const match = link?.pathname.match(/^\/post\/(\d+)/);

            if (!match) {
                throw new Error('Post ID not found');
            }

            const postId = Number(match[1]);
            const content = await getPostBody(postId);

            const body = document.createElement('div');
            body.className = 'md-div';

            if (content.body) {
                body.innerHTML = postMarkdownRenderer.render(content.body);
            }

            if (content.embedDescription) {
                const preview = document.createElement('div');
                preview.className = 'card p-3 my-2';

                // Use textContent because preview descriptions are plain text.
                preview.textContent = content.embedDescription;
                body.appendChild(preview);
            }

            // Render direct MP4/WebM/Ogg video links.
            if (content.url) {
                const url = new URL(content.url, location.href);

                if (
                    ['http:', 'https:'].includes(url.protocol) &&
                    /\.(?:mp4|webm|ogv)$/i.test(url.pathname)
                ) {
                    const video = document.createElement('video');

                    video.src = url.href;
                    video.controls = true;
                    video.preload = 'metadata';
                    video.playsInline = true;

                    video.style.display = 'block';
                    video.style.maxWidth = '100%';
                    video.style.maxHeight = '65vh';
                    video.style.marginTop = '8px';

                    body.appendChild(video);
                }
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'super-lemmy-post-body';
            wrapper.appendChild(body);

            // Open links in new tabs.
            wrapper.querySelectorAll('a[href]').forEach(link => {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            });

            // Insert the rendered body beneath the post title.
            title.after(wrapper);

            setIcon(true);

        } catch (error) {
            console.error(
                '[Super Lemmy] Post expansion failed:',
                error
            );
        } finally {
            delete button.dataset.superLemmyLoading;
        }
    }, true);

})();


