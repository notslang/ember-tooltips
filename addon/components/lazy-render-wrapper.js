import Ember from 'ember';
import layout from 'ember-tooltips/templates/components/lazy-render-wrapper';

const { computed, get, $ } = Ember;
export const targetEventNameSpace = 'target-lazy-render-wrapper';

// https://github.com/emberjs/rfcs/issues/168
// https://github.com/emberjs/ember.js/pull/12500
function getParent(view) {
  if (get(view, 'tagName') === '') {
    // Beware: use of private API! :(
    if (Ember.ViewUtils && Ember.ViewUtils.getViewBounds) {
      return $(Ember.ViewUtils.getViewBounds(view).parentElement);
    } else {
      return $(view._renderNode.contextualElement);
    }
  } else {
    return view.$().parent();
  }
}

const PASSABLE_PROPERTIES = [
	'delay',
	'delayOnChange',
	'duration',
	'effect',
	'event',
	'hideOn',
	'keepInWindow',
	'side',
	'showOn',
	'spacing',
	'isShown',
	'tooltipIsVisible',
	'hideDelay',
	'target',
	'text',

	// non-publicized attributes
	'updateFor',
	'targetAttachment',
	'attachment',
	'role',
	'tabindex',
	'_shouldTargetGrandparentView',
];

const PASSABLE_ACTIONS = [
	'onDestroy',
	'onHide',
	'onRender',
	'onShow',

	// deprecated lifecycle actions
	'onTooltipDestroy',
	'onTooltipHide',
	'onTooltipRender',
	'onTooltipShow',
];

const PASSABLE_OPTIONS = PASSABLE_PROPERTIES.concat(PASSABLE_ACTIONS);

export default Ember.Component.extend({
	tagName: '',
	layout,

	passedPropertiesObject: computed(...PASSABLE_OPTIONS, function() {
		return PASSABLE_OPTIONS.reduce((passablePropertiesObject, key) => {
			// if a property has been declared by Component extension ( TooltipOnElement.extend )
			// or by handlebars instantiation ( {{tooltip-on-element}} ) then that property needs
			// to be passed from this wrapper to the lazy-rendered tooltip or popover component

			let value = this.get(key);

			if (!Ember.isNone(value)) {
				if (PASSABLE_ACTIONS.indexOf(key) >= 0) {
					// if a user has declared a lifecycle action property (onShow='someFunc')
					// then we must pass down the correctly-scoped action instead of value

					passablePropertiesObject[key] = () => this.sendAction(key);
				} else {
					passablePropertiesObject[key] = value;
				}
			}

			return passablePropertiesObject;
		}, {});
	}),

	enableLazyRendering: false,
	_hasUserInteracted: false,
	_hasRendered: false,
	_shouldRender: computed('isShown', 'tooltipIsVisible', 'enableLazyRendering', '_hasUserInteracted', function() {
		// if isShown, tooltipIsVisible, !enableLazyRendering, or _hasUserInteracted then
		// we return true and set _hasRendered to true because
		// there is never a scenario where this wrapper should destroy the tooltip

		if (this.get('_hasRendered')) {

			return true;

		} else if (this.get('isShown') || this.get('tooltipIsVisible')) {

			this.set('_hasRendered', true);
			return true;

		} else if (!this.get('enableLazyRendering')) {

			this.set('_hasRendered', true);
			return true;

		} else if (this.get('_hasUserInteracted')) {

			this.set('_hasRendered', true);
			return true;

		}

		return false;
	}),
	_shouldShowOnRender: false,

	event: 'hover', // hover, click, focus, none
	_lazyRenderEvents: computed('event', function() {
		// the lazy-render wrapper will only render the tooltip when
		// the $target element is interacted with. This CP defines which
		// events will trigger the rendering. Unless event="none" we always
		// include focusin to keep the component accessible.
		let event = this.get('event');

		if (event === 'none') {
			return [];
		}

		let _lazyRenderEvents = ['focusin'];

		if (event === 'hover') {
			_lazyRenderEvents.push('mouseenter');
		} else if (event === 'click') {
			_lazyRenderEvents.push('click');
		}

		return _lazyRenderEvents;
	}),

	/**
	 * A jQuery element that the _lazyRenderEvents will be
	 * attached to during didInsertElement and
	 * removed from during willDestroyElement
	 * @property $target
	 * @type jQuery element
	 * @default the parent jQuery element
	 */
	$target: computed('target', 'tetherComponentName', function() {
		const target = this.get('target'); // #some-id
		let $target;

		if (target) {
			$target = $(target);
		} else if (this.get('tetherComponentName').indexOf('-on-component') >= 0) {
			// TODO(Andrew) refactor this once we've gotten rid of the -on-component approach
			// share the functionality with `onComponentTarget`
			const targetView = this.get('parentView');

			if (!targetView) {
				console.warn('No targetView found');
				return null;
			} else if (!targetView.get('elementId')) {
				console.warn('No targetView.elementId');
				return null;
			}

			const targetViewElementId = targetView.get('elementId');
			$target = $(`#${targetViewElementId}`);
		} else {
			$target = getParent(this);
		}

		return $target;
	}),

	didInsertElement() {
		this._super(...arguments);

		if (this.get('_shouldRender')) {
			// if the tooltip _shouldRender then we don't need
			// any special $target event handling
			return;
		}

		let $target = this.get('$target');

		if (this.get('event') === 'hover') {
			// We've seen instances where a user quickly mouseenter and mouseleave the $target.
			// By providing this event handler we ensure that the tooltip will only *show*
			// if the user has mouseenter and not mouseleave immediately afterwards.
			$target.on(`mouseleave.${targetEventNameSpace}`, () => {
				this.set('_shouldShowOnRender', false);
			});
		}

		this.get('_lazyRenderEvents').forEach((entryInteractionEvent) => {
			$target.on(`${entryInteractionEvent}.${targetEventNameSpace}`, () => {
				if (this.get('_hasUserInteracted')) {
					$target.off(`${entryInteractionEvent}.${targetEventNameSpace}`);
				} else {
					this.set('_hasUserInteracted', true);
					this.set('_shouldShowOnRender', true);
				}
			});
		});
	},

	childView: null, // this is set during the childView's didRender and is needed for the hide action
	actions: {
		hide() {
			const childView = this.get('childView');

			// childView.actions is not available in Ember 1.13
			// We will use childView._actions until we drop support for Ember 1.13
			if (childView && childView._actions && childView._actions.hide) {
				childView.send('hide');
			}
		},
	},

	willDestroyElement() {
		this._super(...arguments);

		const $target = this.get('$target');
		this.get('_lazyRenderEvents').forEach((entryInteractionEvent) => {
			$target.off(`${entryInteractionEvent}.${targetEventNameSpace}`);
		});

		$target.off(`mouseleave.${targetEventNameSpace}`);
	},
});
