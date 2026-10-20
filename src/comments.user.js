// ==UserScript==
// @name         Lemmy Reddit-style Comments
// @namespace    paul-lemmy
// @version      0.2
// @description  Adds dynamic comment-depth styling hooks to Lemmy
// @include      /^https:\/\/(lemmy\.[^/]+|feddit\.org)(\/|$)/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const THREAD_HUES = [
        210, // blue
        165, // teal
        135, // green
        250, // violet
        285, // purple
        320, // magenta
        190  // cyan
    ];

    function moveCommentScores(root = document) {
        root.querySelectorAll('article.comment-node').forEach(article => {
            const buttons = article.querySelector(
                ':scope .comment-bottom-btns'
            );

            if (!buttons) return;

            const upButton = buttons.querySelector(
                'button[aria-label="Upvote"]'
            );

            const downButton = buttons.querySelector(
                'button[aria-label="Downvote"]'
            );

            if (!upButton || !downButton) return;

            /*
         * Lemmy puts BOTH current totals on the voting buttons:
         *
         * data-tippy-content="29 Upvotes · 3 Downvotes"
         *
         * This avoids all of the conditional header markup.
         */
            const tooltip =
                  upButton.getAttribute('data-tippy-content') ||
                  downButton.getAttribute('data-tippy-content') ||
                  '';

            const upMatch =
                  tooltip.match(/(\d+)\s+Upvotes?/i);

            const downMatch =
                  tooltip.match(/(\d+)\s+Downvotes?/i);

            if (!upMatch) return;

            const upCount = upMatch[1];
            const downCount = downMatch ? downMatch[1] : '0';

            /*
         * Create/update upvote count.
         */
            let upDisplay =
                buttons.querySelector('.reddit-upvote-count');

            if (!upDisplay) {
                upDisplay = document.createElement('span');
                upDisplay.className =
                    'reddit-vote-count reddit-upvote-count';

                upButton.after(upDisplay);
            }

            upDisplay.textContent = upCount;

            /*
         * Create/update downvote count.
         */
            let downDisplay =
                buttons.querySelector('.reddit-downvote-count');

            if (!downDisplay) {
                downDisplay = document.createElement('span');
                downDisplay.className =
                    'reddit-vote-count reddit-downvote-count';

                downButton.after(downDisplay);
            }

            downDisplay.textContent = downCount;

            /*
         * Mark every ORIGINAL header vote display.
         *
         * Handles:
         *   1 Upvote
         *   2 Upvotes
         *   1 Downvote
         *   3 Downvotes
         */
            article.querySelectorAll(
                ':scope [aria-label$=" Upvote"],' +
                ':scope [aria-label$=" Upvotes"],' +
                ':scope [aria-label$=" Downvote"],' +
                ':scope [aria-label$=" Downvotes"]'
            ).forEach(el => {
                /*
             * Don't hide the actual voting buttons.
             */
                if (!el.closest('.comment-bottom-btns')) {
                    el.classList.add(
                        'reddit-original-vote-count'
                    );
                }
            });

            /*
         * Find the header separator belonging to the vote totals.
         */
            article.querySelectorAll(':scope span.mx-2').forEach(el => {
                if (
                    el.textContent.trim() === '·' &&
                    !el.closest('.comment-bottom-btns')
                ) {
                    el.classList.add(
                        'reddit-original-vote-separator'
                    );
                }
            });
        });
    }

    /*
     * Determine the depth of a comment.
     *
     * A top-level comment has depth 0.
     * Every parent <li class="comment"> adds one level.
     */
    function getCommentDepth(comment) {
        let depth = 0;
        let parent = comment.parentElement;

        while (parent) {
            if (parent.matches('ul.comments')) {
                depth++;
            }

            parent = parent.parentElement;
        }

        /*
     * The outermost ul.comments contains the top-level comments,
     * so subtract it.
     */
        return Math.max(0, depth - 1);
    }

    function addCollapseStrip(comment, article) {
        if (article.querySelector(':scope > .reddit-collapse-strip')) {
            return;
        }

        const strip = document.createElement('div');

        strip.className = 'reddit-collapse-strip';
        strip.title = 'Collapse thread';

        strip.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            toggleComment(article);
        });

        article.prepend(strip);
    }

    /*
     * Add depth information and CSS variables to every comment.
     */
    function processComments(root = document) {
        root.querySelectorAll('li.comment').forEach(comment => {
            const article = comment.querySelector(
                ':scope > article.comment-node'
            );

            if (!article) {
                return;
            }

            addCollapseStrip(comment, article);

            const depth = getCommentDepth(comment);

            /*
             * Golden-angle hue distribution prevents a short,
             * obvious repeating color sequence.
             */
            const hue = THREAD_HUES[depth % THREAD_HUES.length];

            article.dataset.threadDepth = depth;
            article.style.setProperty('--thread-depth', depth);
            article.style.setProperty('--thread-hue', hue);

            /*
             * The nested UL represents the replies belonging
             * to this comment. Give its line the NEXT depth's hue.
             */
            const replies = comment.querySelector(
                ':scope > ul.comments'
            );

            if (replies) {
                const replyHue =
                      THREAD_HUES[(depth + 1) % THREAD_HUES.length];

                replies.dataset.threadDepth = depth + 1;
                replies.style.setProperty(
                    '--thread-depth',
                    depth + 1
                );
                replies.style.setProperty(
                    '--thread-hue',
                    replyHue
                );

                /*
                 * Lemmy supplies its own inline colored border.
                 * Remove it so Stylus can control the line.
                 */
                replies.style.removeProperty('border-left');
            }
        });
    }

    /*
 * ============================================================
 * Old-Lemmy-style front-page metadata
 * ============================================================
 */

    function processPostMetadata(root = document) {
        root.querySelectorAll('a.person-listing').forEach(person => {
            const meta = person.closest('div.small');

            if (!meta || meta.classList.contains('old-lemmy-meta')) {
                return;
            }

            const community = meta.querySelector('a.community-link');
            const time = meta.querySelector('.moment-time');

            if (!community || !time) {
                return;
            }

            const personClone = person.cloneNode(true);
            const communityClone = community.cloneNode(true);
            const timeClone = time.cloneNode(true);

            /* Kill avatars/icons in the new metadata */
            personClone.querySelectorAll('picture, img').forEach(el => el.remove());
            communityClone.querySelectorAll('picture, img').forEach(el => el.remove());

            /* Clean username */
            const personName = personClone.querySelector('span');
            if (personName) {
                personName.textContent = personName.textContent.trim();
            }

            /* c/Technology */
            const communityName = communityClone.querySelector(
                '.overflow-wrap-anywhere'
            );

            if (communityName) {
                const name = communityName.textContent.trim();

                if (!name.startsWith('c/')) {
                    communityName.textContent = 'c/' + name;
                }
            }

            const newMeta = document.createElement('div');
            newMeta.className = 'small old-lemmy-meta';

            newMeta.append(
                document.createTextNode('submitted '),
                timeClone,
                document.createTextNode(' by '),
                personClone,
                document.createTextNode(' to '),
                communityClone
            );

            meta.replaceWith(newMeta);
        });
    }

    /*
     * Super Lemmy: resize expanded post images and images in comment bodies.
     * Only initialize on post/comment pages, not on the front-page feed.
     */
    function initializeResizableImage(img) {
        if (img.dataset.superLemmyCommentResize === 'true') return;
        img.dataset.superLemmyCommentResize = 'true';

        const link = img.closest('a[href]');
        if (link) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        img.style.maxWidth = 'none';
        img.style.setProperty('max-height', 'none', 'important');
        img.style.height = 'auto';
        img.style.userSelect = 'none';
        img.draggable = false;

        function setInitialSize() {
            if (img.dataset.superLemmyManuallyResized === 'true') return;
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (!w || !h) return;

            const column = img.closest('.post-listing, article.comment-node');
            const rightEdge = column
            ? column.getBoundingClientRect().right
            : document.documentElement.clientWidth;
            const availableWidth = Math.max(
                100, rightEdge - img.getBoundingClientRect().left - 20
            );
            const maxInitialHeight = window.innerHeight * (
                img.matches('.post-listing img.img-expanded') ? 0.65 : 0.45
            );            const scale = Math.min(1, availableWidth / w, maxInitialHeight / h);
            img.style.width = `${w * scale}px`;
        }

        if (img.complete && img.naturalWidth) {
            requestAnimationFrame(setInitialSize);
        } else {
            img.addEventListener('load', setInitialSize, { once: true });
        }

        let pointerDown = false;
        let resized = false;
        let suppressClick = false;
        let startX = 0;
        let startWidth = 0;
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
            img.style.width = `${Math.max(100, startWidth + delta)}px`;
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

        img.addEventListener('click', event => {
            if (!suppressClick) return;
            event.preventDefault();
            event.stopPropagation();
            suppressClick = false;
        }, true);
    }

    function scanResizableImages() {
        if (!/^\/post\/\d+/.test(location.pathname)) return;

        document.querySelectorAll(
            '.post-listing img.img-expanded, ' +
            '.post-listing .md-div img, ' +  // NEW: images embedded in post body
            'article.comment-node .md-div img, ' +
            'article.comment-node .comment-content img'
        ).forEach(img => {
            if (img.matches('.emoji, .avatar') ||
                img.closest('.emoji, .avatar, .person-listing')) return;

            initializeResizableImage(img);
        });
    }

    /*
     * Initial page.
     */
    processComments();
    processPostMetadata();
    moveCommentScores();
    scanResizableImages();

    /*
     * Lemmy dynamically inserts/re-renders comments, so process
     * new DOM content as it appears.
     */
    let scheduled = false;

    const observer = new MutationObserver(() => {
        if (scheduled) {
            return;
        }

        scheduled = true;

        requestAnimationFrame(() => {
            processComments();
            processPostMetadata();
            moveCommentScores();
            scanResizableImages();
            scheduled = false;
        });
    });

    /*
 * ============================================================
 * Reddit-style comment collapsing
 * ============================================================
 */

    function getNativeCollapseButton(article) {
        return article.querySelector(
            'button[aria-label="Collapse"], button[aria-label="Expand"]'
        );
    }

    function toggleComment(article) {
        const button = getNativeCollapseButton(article);

        if (button) {
            button.click();
        }
    }

    /*
 * Click the comment header to collapse.
 *
 * Interactive elements are excluded so usernames, links,
 * voting controls, menus, etc. continue to work normally.
 */
    document.addEventListener('click', event => {
        const article = event.target.closest('article.comment-node');

        if (!article) {
            return;
        }

        /*
     * Don't hijack normal controls.
     */
        if (event.target.closest(
            'a, button, input, textarea, select, label'
        )) {
            return;
        }

        /*
     * Lemmy's header is the first flex row in the comment.
     */
        const header = event.target.closest(
            'article.comment-node > .ms-2 > .d-flex:first-child'
        );

        if (header) {
            toggleComment(article);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    /*
    * ============================================================
    * Super Lemmy — Open links in new tabs
    * ============================================================
    */

    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');

        if (!link || !/^\/post\/\d+/.test(location.pathname)) return;

        // Ignore modified clicks; preserve browser behavior.
        if (event.ctrlKey || event.metaKey ||
            event.shiftKey || event.altKey) return;

        // Ignore anchors, JavaScript URLs, and downloads.
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') ||
            href.startsWith('javascript:') ||
            link.hasAttribute('download')) return;

        // Let Firefox open the link in a new tab.
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    }, true);

})();
